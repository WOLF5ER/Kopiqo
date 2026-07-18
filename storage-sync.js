// ============================================================================
// Kopiqo — облачное хранилище (замена storage-shim.js).
//
// Предоставляет тот же window.storage API (get/set/delete/list), которым
// пользуется app.compiled.js, поэтому код приложения не меняется вовсе.
//
// Как это работает (локально-первый подход):
//   • Все чтения/записи идут мгновенно в localStorage-кэш (быстро, офлайн).
//   • Кэш разделён по пользователям: kopiqo:<user_id>:<ключ>.
//   • Если на устройстве уже есть локальные данные — приложение стартует
//     сразу с ними, не дожидаясь сети. Сверка с облаком идёт в фоне и
//     подменяет кэш, только если там действительно более новая версия
//     (по updated_at из Supabase), с последующей тихой перезагрузкой.
//   • Если локальных данных ещё нет (первый вход на этом устройстве) —
//     дожидаемся облака один раз, это неизбежно.
//   • После любого изменения запускается отложенная (600 мс) синхронизация:
//     всё содержимое кэша целиком кладётся в jsonb-поле data единственной
//     строки пользователя в таблице finance_data (привязка по auth.uid()).
//   • При закрытии вкладки несинхронизированные изменения досылаются через
//     fetch с keepalive.
// ============================================================================
import {
  supabase,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
} from "./supabase-client.js";

const LEGACY_PREFIX = "kopiqo:"; // префикс старого офлайн-шима
const SYNC_DEBOUNCE_MS = 600;
const RETRY_DELAY_MS = 5000;
const SYNCED_AT_KEY = "__syncedAt"; // метка времени последней известной серверной версии

let userId = null;
let cachePrefix = null;
let accessToken = null;

let syncTimer = null;
let retryTimer = null;
let dirty = false;       // есть изменения, не отправленные в Supabase
let pushInFlight = null; // текущий push (Promise)

/* ------------------------------ Инициализация ----------------------------- */

/**
 * Вызывается один раз после успешной авторизации, ДО монтирования приложения.
 *
 * Локально-первый подход: если на устройстве уже есть кэш этого пользователя,
 * window.storage включается немедленно на этих данных, а сверка с облаком
 * уходит в фоновую задачу. Если кэша ещё нет — ждём облако один раз (иначе
 * показать нечего).
 */
export async function initCloudStorage(session) {
  userId = session.user.id;
  cachePrefix = `kopiqo:${userId}:`;
  accessToken = session.access_token;

  // Держим свежий access token для keepalive-запроса при закрытии вкладки.
  supabase.auth.onAuthStateChange((_event, s) => {
    if (s) accessToken = s.access_token;
  });

  installStorageApi();
  installFlushHooks();

  if (hasLocalCache()) {
    // Есть с чем работать прямо сейчас — не ждём сеть, сверяемся в фоне.
    reconcileWithCloudInBackground();
    return { remoteLoaded: false, source: "local" };
  }

  // Первый вход на этом устройстве: локально показывать нечего, придётся
  // дождаться облака (или засеять его тем, что есть в старом офлайн-кэше).
  let remoteLoaded = false;
  try {
    const { data: row, error } = await supabase
      .from("finance_data")
      .select("data, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;

    if (row && row.data && typeof row.data === "object") {
      hydrateCache(row.data, row.updated_at);
      remoteLoaded = true;
    } else {
      // Первая авторизация этого аккаунта: строки в облаке ещё нет.
      // Если на устройстве остались данные от офлайн-версии Kopiqo —
      // бережно переносим их в облако, чтобы ничего не потерялось.
      const seed = collectSeedData();
      const { data: upserted, error: upsertError } = await supabase
        .from("finance_data")
        .upsert({ user_id: userId, data: seed }, { onConflict: "user_id" })
        .select("updated_at")
        .maybeSingle();
      if (upsertError) throw upsertError;
      hydrateCache(seed, upserted && upserted.updated_at);
      remoteLoaded = true;
    }
  } catch (e) {
    // Нет сети или Supabase недоступен — работаем с тем, что есть (может
    // быть пусто), синхронизация возобновится автоматически.
    console.warn("Kopiqo: облако недоступно, используем локальный кэш.", e);
    scheduleRetry();
  }

  return { remoteLoaded };
}

/** Принудительная отправка несохранённых изменений (например, перед выходом). */
export async function flushPendingSync() {
  clearTimeout(syncTimer);
  syncTimer = null;
  if (pushInFlight) await pushInFlight.catch(() => {});
  if (dirty) await pushToSupabase().catch(() => {});
}

/* ------------------------------ window.storage ---------------------------- */

function hasLocalCache() {
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(cachePrefix) && !k.endsWith(SYNCED_AT_KEY)) return true;
  }
  return false;
}

function installStorageApi() {
  const ok = (key, value) => ({ key, value, shared: false });

  window.storage = {
    async get(key) {
      const raw = window.localStorage.getItem(cachePrefix + key);
      if (raw === null) return null;
      return ok(key, raw);
    },

    async set(key, value) {
      try {
        window.localStorage.setItem(cachePrefix + key, value);
      } catch (e) {
        console.error("Kopiqo: не удалось записать в локальный кэш:", e);
        return null; // приложение покажет свою ошибку сохранения с кнопкой Retry
      }
      markDirtyAndSchedule();
      return ok(key, value);
    },

    async delete(key) {
      const existed = window.localStorage.getItem(cachePrefix + key) !== null;
      window.localStorage.removeItem(cachePrefix + key);
      if (existed) markDirtyAndSchedule();
      return existed ? { key, deleted: true, shared: false } : null;
    },

    async list(prefix) {
      const keys = [];
      const scan = cachePrefix + (prefix || "");
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(scan) && !k.endsWith(SYNCED_AT_KEY)) keys.push(k.slice(cachePrefix.length));
      }
      return { keys, prefix: prefix || undefined, shared: false };
    },
  };
}

/* ------------------------- Фоновая сверка с облаком ------------------------ */

/**
 * Сравнивает облако с тем, что мы в последний раз считали "своим" (по
 * updated_at). Перезаписывает локальный кэш и мягко перезагружает страницу
 * ТОЛЬКО если в облаке действительно более новая версия — например, данные
 * поменяли с другого устройства. Свои же изменения, которые мы только что
 * отправили, под это не попадают: после успешного push локальная метка уже
 * обновлена, и облако не покажется "новее".
 */
function reconcileWithCloudInBackground() {
  supabase
    .from("finance_data")
    .select("data, updated_at")
    .eq("user_id", userId)
    .maybeSingle()
    .then(({ data: row, error }) => {
      if (error || !row) return;
      const known = window.localStorage.getItem(cachePrefix + SYNCED_AT_KEY);
      const cloudIsNewer = !known || (row.updated_at && new Date(row.updated_at) > new Date(known));
      if (!cloudIsNewer || dirty || pushInFlight) return; // свои несинхронизированные правки не затираем
      hydrateCache(row.data || {}, row.updated_at);
      window.location.reload();
    })
    .catch((e) => {
      console.warn("Kopiqo: фоновая сверка с облаком не удалась, продолжаем с локальным кэшем.", e);
    });
}

/* ------------------------------ Синхронизация ----------------------------- */

function markDirtyAndSchedule() {
  dirty = true;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    pushToSupabase().catch(() => scheduleRetry());
  }, SYNC_DEBOUNCE_MS);
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!dirty) return;
    if (!navigator.onLine) {
      scheduleRetry(); // офлайн: продолжаем ждать (плюс сработает событие online)
      return;
    }
    pushToSupabase().catch(() => scheduleRetry());
  }, RETRY_DELAY_MS);
}

function buildDataObject() {
  const data = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(cachePrefix) && !k.endsWith(SYNCED_AT_KEY)) {
      data[k.slice(cachePrefix.length)] = window.localStorage.getItem(k);
    }
  }
  return data;
}

async function pushToSupabase() {
  if (pushInFlight) return pushInFlight;
  dirty = false;
  const payload = { user_id: userId, data: buildDataObject() };

  pushInFlight = supabase
    .from("finance_data")
    .upsert(payload, { onConflict: "user_id" })
    .select("updated_at")
    .maybeSingle()
    .then(({ data: row, error }) => {
      if (error) throw error;
      // Наша собственная правка теперь и есть последняя известная версия —
      // фоновая сверка не должна принять её за "более новую с другого устройства".
      if (row && row.updated_at) {
        window.localStorage.setItem(cachePrefix + SYNCED_AT_KEY, row.updated_at);
      }
    })
    .finally(() => {
      pushInFlight = null;
    });

  try {
    await pushInFlight;
  } catch (e) {
    dirty = true; // изменения всё ещё не в облаке
    console.warn("Kopiqo: синхронизация не удалась, повторим позже.", e);
    throw e;
  }

  // Пока шёл запрос, могли появиться новые изменения.
  if (dirty && !syncTimer) markDirtyAndSchedule();
}

function installFlushHooks() {
  // При восстановлении сети — досылаем изменения.
  window.addEventListener("online", () => {
    if (dirty) pushToSupabase().catch(() => scheduleRetry());
  });

  // При сворачивании/закрытии вкладки — отправляем остаток через keepalive,
  // обычный асинхронный запрос браузер может не успеть выполнить.
  const flushKeepalive = () => {
    if (!dirty || !accessToken) return;
    try {
      fetch(
        `${SUPABASE_URL}/rest/v1/finance_data?user_id=eq.${encodeURIComponent(userId)}`,
        {
          method: "PATCH",
          keepalive: true,
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ data: buildDataObject() }),
        }
      );
      dirty = false;
    } catch (_) {
      /* ничего: попробуем при следующем открытии */
    }
  };

  window.addEventListener("pagehide", flushKeepalive);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushKeepalive();
  });
}

/* ------------------------- Гидрация и миграция кэша ----------------------- */

function hydrateCache(dataObject, updatedAt) {
  // Полностью заменяем кэш пользователя содержимым облака.
  const stale = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(cachePrefix) && !k.endsWith(SYNCED_AT_KEY)) stale.push(k);
  }
  stale.forEach((k) => window.localStorage.removeItem(k));

  for (const [key, value] of Object.entries(dataObject)) {
    if (typeof value === "string") {
      try {
        window.localStorage.setItem(cachePrefix + key, value);
      } catch (e) {
        console.error("Kopiqo: кэш переполнен при гидрации:", e);
      }
    }
  }
  if (updatedAt) window.localStorage.setItem(cachePrefix + SYNCED_AT_KEY, updatedAt);
}

/**
 * Данные для первой строки нового аккаунта:
 *  1) кэш этого же пользователя (если строку в облаке удаляли вручную);
 *  2) иначе — данные старой офлайн-версии (префикс kopiqo: без user_id).
 */
function collectSeedData() {
  const own = {};
  const legacy = {};
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:/i;

  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k || !k.startsWith(LEGACY_PREFIX)) continue;
    const rest = k.slice(LEGACY_PREFIX.length);
    const value = window.localStorage.getItem(k);
    if (k.startsWith(cachePrefix)) {
      if (!rest.endsWith(SYNCED_AT_KEY)) own[k.slice(cachePrefix.length)] = value;
    } else if (!uuidLike.test(rest)) {
      legacy[rest] = value; // данные офлайн-версии Kopiqo
    }
  }

  if (Object.keys(own).length > 0) return own;
  return legacy; // может быть пустым объектом — это нормально
}
