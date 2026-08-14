
const WikiStorage = (() => {
  const DB_NAME = "personal-wiki-v2";
  const DB_VERSION = 1;
  const STORE = "files";
  const TOKEN_KEY = "personalWikiDropboxToken";
  const APP_KEY_KEY = "personalWikiDropboxAppKey";
  const ROLE_KEY = "personalWikiDeviceRole";
  const ROOT_KEY = "personalWikiDropboxRoot";
  const DEFAULT_ROOT = "/PersonalWiki";

  let dbPromise = null;

  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: "path" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function idbPut(rec) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGet(path) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const req = d.transaction(STORE, "readonly").objectStore(STORE).get(path);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbAll() {
    const d = await db();
    return new Promise((resolve, reject) => {
      const req = d.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function rootPath() {
    return localStorage.getItem(ROOT_KEY) || DEFAULT_ROOT;
  }

  function appKey() {
    return localStorage.getItem(APP_KEY_KEY) || window.PERSONAL_WIKI_CONFIG?.dropboxAppKey || "";
  }

  function setAppKey(v) {
    localStorage.setItem(APP_KEY_KEY, String(v || "").trim());
  }

  function getRole() {
    return localStorage.getItem(ROLE_KEY) || "secondary";
  }

  function setRole(v) {
    localStorage.setItem(ROLE_KEY, v === "pc" ? "pc" : "secondary");
  }

  function getRedirectUri() {
    return location.origin + location.pathname;
  }

  function getTokenState() {
    try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || "null"); }
    catch { return null; }
  }

  function setTokenState(v) {
    if (!v) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, JSON.stringify(v));
  }

  function isConnected() {
    const t = getTokenState();
    return !!(t?.access_token || t?.refresh_token);
  }

  function online() {
    return navigator.onLine;
  }

  // Dropbox-API-Arg must be HTTP-header-safe.
  // Escape DEL (0x7F) and all non-ASCII characters using JSON-style \uXXXX.
  function dropboxHeaderJson(value) {
    return JSON.stringify(value).replace(/[\u007f-\uffff]/g, function(c) {
      return "\\u" + ("000" + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  function base64Url(bytes) {
    let s = "";
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function randomVerifier() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const bytes = crypto.getRandomValues(new Uint8Array(64));
    return Array.from(bytes, b => chars[b % chars.length]).join("");
  }

  async function sha256(s) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  }

  async function beginLogin() {
    const key = appKey();
    if (!key) throw new Error("Dropbox App Key が設定されていません。");
    const verifier = randomVerifier();
    const challenge = base64Url(await sha256(verifier));
    sessionStorage.setItem("pw_pkce_verifier", verifier);

    const q = new URLSearchParams({
      client_id: key,
      response_type: "code",
      redirect_uri: getRedirectUri(),
      code_challenge: challenge,
      code_challenge_method: "S256",
      token_access_type: "offline"
    });
    location.href = "https://www.dropbox.com/oauth2/authorize?" + q.toString();
  }

  async function finishLoginFromCallback() {
    const u = new URL(location.href);
    const code = u.searchParams.get("code");
    if (!code) return false;

    const verifier = sessionStorage.getItem("pw_pkce_verifier");
    if (!verifier) throw new Error("PKCE verifier が見つかりません。もう一度接続してください。");

    const body = new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: appKey(),
      redirect_uri: getRedirectUri(),
      code_verifier: verifier
    });

    const r = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: {"Content-Type":"application/x-www-form-urlencoded"},
      body
    });
    if (!r.ok) throw new Error("Dropbox認証に失敗しました: " + await r.text());
    const data = await r.json();
    setTokenState({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 14400) * 1000
    });
    sessionStorage.removeItem("pw_pkce_verifier");
    history.replaceState({}, "", getRedirectUri());
    return true;
  }

  async function refreshAccessToken() {
    const t = getTokenState();
    if (!t?.refresh_token) throw new Error("Dropboxへ再接続してください。");
    const body = new URLSearchParams({
      refresh_token: t.refresh_token,
      grant_type: "refresh_token",
      client_id: appKey()
    });
    const r = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body
    });
    if (!r.ok) throw new Error("Dropboxログインの更新に失敗しました。");
    const data = await r.json();
    setTokenState({
      access_token: data.access_token,
      refresh_token: t.refresh_token,
      expires_at: Date.now() + (data.expires_in || 14400) * 1000
    });
    return data.access_token;
  }

  async function accessToken() {
    const t = getTokenState();
    if (!t) throw new Error("Dropboxに接続されていません。");
    if (t.access_token && (!t.expires_at || t.expires_at > Date.now() + 60000)) return t.access_token;
    return refreshAccessToken();
  }

  async function api(path, body) {
    const token = await accessToken();
    const r = await fetch("https://api.dropboxapi.com/2/" + path, {
      method:"POST",
      headers:{
        "Authorization":"Bearer " + token,
        "Content-Type":"application/json"
      },
      body: JSON.stringify(body || {})
    });
    if (!r.ok) {
      const e = new Error(`Dropbox API error ${r.status}: ${await r.text()}`);
      e.status = r.status;
      throw e;
    }
    return r.json();
  }

  async function listAll() {
    // App Folder access is already rooted at the Dropbox app folder.
    // Enumerate from "" (the API root) and find PersonalWiki beneath it.
    let res = await api("files/list_folder", {
      path: "",
      recursive: true,
      include_deleted: false
    });
    const entries = [...res.entries];
    while (res.has_more) {
      res = await api("files/list_folder/continue", { cursor: res.cursor });
      entries.push(...res.entries);
    }
    return entries;
  }

  async function download(path, asBlob=false) {
    const token = await accessToken();
    const r = await fetch("https://content.dropboxapi.com/2/files/download", {
      method:"POST",
      headers:{
        "Authorization":"Bearer " + token,
        "Dropbox-API-Arg": dropboxHeaderJson({path})
      }
    });
    if (!r.ok) throw new Error(`Dropbox download error ${r.status}: ${await r.text()}`);
    const meta = JSON.parse(r.headers.get("Dropbox-API-Result") || "{}");
    if (asBlob) return {content: await r.blob(), meta};
    return {content: await r.text(), meta};
  }

  async function ensureFolder(path) {
    const parts = path.split("/").filter(Boolean);
    let cur = "";
    for (const p of parts) {
      cur += "/" + p;
      try { await api("files/create_folder_v2", {path:cur, autorename:false}); }
      catch (e) {
        if (!String(e.message).includes("conflict")) throw e;
      }
    }
  }

  async function initializeFolders() {
    const root = rootPath();
    for (const p of [
      root,
      root + "/articles",
      root + "/articles/main",
      root + "/articles/help",
      root + "/files",
      root + "/templates"
    ]) await ensureFolder(p);
  }

  async function uploadText(path, text, rev=null, isNew=false) {
    if (!online()) throw new Error("オフライン中は編集内容を保存できません。");
    const token = await accessToken();
    const role = getRole();
    let mode;
    if (role === "pc") mode = "overwrite";
    else if (isNew) mode = "add";
    else if (rev) mode = {".tag":"update","update":rev};
    else mode = "overwrite";

    const args = {
      path,
      mode,
      autorename:false,
      mute:false,
      strict_conflict:true
    };
    const r = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method:"POST",
      headers:{
        "Authorization":"Bearer " + token,
        "Content-Type":"application/octet-stream",
        "Dropbox-API-Arg": dropboxHeaderJson(args)
      },
      body: new TextEncoder().encode(text)
    });
    if (!r.ok) {
      const msg = await r.text();
      const e = new Error(msg);
      e.status = r.status;
      if (r.status === 409 && role !== "pc") {
        e.code = "CONFLICT";
        e.message = "PC側またはクラウド側に新しい更新があるため、この端末からの保存を拒否しました。編集内容は画面に残っています。";
      }
      throw e;
    }
    return r.json();
  }

  function articleRowFromRecord(rec) {
    const p = rec.path_display || rec.path || "";
    // Dropbox App Folder内のどこから取得しても、/articles/ を基準に解析する。
    // /PersonalWiki の有無や大文字小文字には依存しない。
    const marker = "/articles/";
    const low = p.toLowerCase();
    const i = low.indexOf(marker);
    if (i < 0) return null;

    const rel = p.slice(i + marker.length);
    const parts = rel.split("/").filter(Boolean);
    if (parts.length < 2) return null;

    const section = parts.shift().toLowerCase();
    if (section !== "main" && section !== "help") return null;

    let articleType = section === "help" ? "ヘルプ" : (parts.shift() || "記事");
    if (!parts.length) return null;

    const file = parts[parts.length - 1];
    let pathParts, title, logicalTitle;

    if (file.toLowerCase() === "index.txt") {
      pathParts = parts.slice(0, -1);
      if (!pathParts.length) return null;
      title = pathParts[pathParts.length - 1];
      logicalTitle = pathParts.join("/");
    } else if (file.toLowerCase().endsWith(".txt")) {
      const stem = file.slice(0, -4);
      pathParts = parts.slice(0, -1);
      title = stem;
      logicalTitle = [...pathParts, stem].join("/");
    } else {
      return null;
    }

    // help は articleType を持たず、help直下/下位フォルダをそのまま論理パスにする。
    if (section === "help") {
      const helpParts = rel.split("/").filter(Boolean).slice(1);
      const helpFile = helpParts[helpParts.length - 1];
      if (helpFile.toLowerCase() === "index.txt") {
        pathParts = helpParts.slice(0, -1);
        if (!pathParts.length) return null;
        title = pathParts[pathParts.length - 1];
        logicalTitle = pathParts.join("/");
      } else {
        const stem = helpFile.slice(0, -4);
        pathParts = helpParts.slice(0, -1);
        title = stem;
        logicalTitle = [...pathParts, stem].join("/");
      }
    }

    return {
      title, logicalTitle, text: rec.text || "",
      section,
      sectionLabel: section === "main" ? "記事" : "ヘルプ",
      articleType,
      pathParts,
      dropboxPath: p,
      rev: rec.rev || null,
      server_modified: rec.server_modified || null
    };
  }

  async function syncTextData() {
    if (!online() || !isConnected()) return;
    const entries = await listAll();
    const wanted = entries.filter(e => e[".tag"] === "file" && (
      /\/articles\/.*\.txt$/i.test(e.path_display) ||
      /\/templates\/.*\.txt$/i.test(e.path_display)
    ));
    for (const e of wanted) {
      const cached = await idbGet(e.path_display);
      if (cached?.rev === e.rev && typeof cached.text === "string") continue;
      const {content, meta} = await download(e.path_display, false);
      await idbPut({
        path:e.path_display,
        kind:/\/templates\//i.test(e.path_display) ? "template" : "text",
        text:content,
        rev:meta.rev || e.rev,
        server_modified:meta.server_modified || e.server_modified || null,
        cached_at:Date.now()
      });
    }
  }

  async function loadArticles() {
    if (online() && isConnected()) {
      await syncTextData();
    }
    const all = await idbAll();
    return all
      .filter(r => r.kind === "text" && /\/articles\//i.test(r.path))
      .map(r => articleRowFromRecord({...r, path_display:r.path}))
      .filter(Boolean);
  }

  async function loadTemplates() {
    const all = await idbAll();
    const out = new Map();
    const root = rootPath().toLowerCase();
    for (const r of all) {
      if (r.kind !== "template") continue;
      const p = r.path;
      const low = p.toLowerCase();
      const marker = "/templates/";
      const i = low.indexOf(marker);
      if (i < 0) continue;
      const rel = p.slice(i + marker.length);
      if (!rel.toLowerCase().endsWith(".txt")) continue;
      out.set(rel.slice(0,-4), r.text || "");
    }
    return out;
  }

  async function imageUrl(filename) {
    const path = rootPath() + "/files/" + filename;
    let rec = await idbGet(path);
    if ((!rec || !rec.blob) && online() && isConnected()) {
      try {
        const {content, meta} = await download(path, true);
        rec = {path, kind:"image", blob:content, rev:meta.rev || null, cached_at:Date.now()};
        await idbPut(rec);
      } catch (e) {
        console.warn(e);
      }
    }
    return rec?.blob ? URL.createObjectURL(rec.blob) : null;
  }

  async function hydrateImages(root=document) {
    const imgs = [...root.querySelectorAll("img[data-wiki-image]")];
    for (const img of imgs) {
      const url = await imageUrl(img.dataset.wikiImage);
      if (url) img.src = url;
      else {
        img.alt = (img.alt || "") + "（画像未キャッシュ）";
        img.classList.add("wiki-image-missing");
      }
    }
  }

  async function saveExisting(meta, text) {
    if (!meta?.dropboxPath) throw new Error("Dropbox上の保存先が不明です。");
    const saved = await uploadText(meta.dropboxPath, text, meta.rev, false);
    await idbPut({
      path:saved.path_display,
      kind:/\/templates\//i.test(saved.path_display) ? "template" : "text",
      text,
      rev:saved.rev,
      server_modified:saved.server_modified || null,
      cached_at:Date.now()
    });
    return saved;
  }

  async function listArticleTypes() {
    const entries = await listAll();
    const types = new Set();

    for (const e of entries) {
      if (e[".tag"] !== "folder") continue;
      const p = e.path_display || "";
      const low = p.toLowerCase();
      const marker = "/articles/main/";
      const i = low.indexOf(marker);
      if (i < 0) continue;

      const rel = p.slice(i + marker.length);
      const parts = rel.split("/").filter(Boolean);
      if (parts.length === 1) types.add(parts[0]);
    }

    return [...types].sort((a,b)=>a.localeCompare(b,"ja"));
  }

  async function createArticleType(name) {
    if (!online()) throw new Error("オフライン中は記事種別を作成できません。");
    const clean = String(name || "").trim();
    if (!clean) throw new Error("記事種別名を入力してください。");
    const path = rootPath() + "/articles/main/" + clean;
    await ensureFolder(path);
    return clean;
  }

  async function createArticle(articleType, logicalTitle, text) {
    if (!online()) throw new Error("オフライン中は新規記事を作成できません。");
    const safeType = String(articleType || "記事").trim();
    const parts = String(logicalTitle || "").split("/").map(s=>s.trim()).filter(Boolean);
    if (!parts.length) throw new Error("記事名を入力してください。");
    const parent = rootPath() + "/articles/main/" + safeType + "/" + parts.join("/");
    await ensureFolder(parent);
    const path = parent + "/index.txt";
    const saved = await uploadText(path, text || "", null, true);
    await idbPut({path:saved.path_display, kind:"text", text:text||"", rev:saved.rev, server_modified:saved.server_modified||null, cached_at:Date.now()});
    return saved;
  }

  async function createTemplate(name, text) {
    if (!online()) throw new Error("オフライン中はテンプレートを作成できません。");
    const clean = String(name||"").trim().replace(/^\/+|\/+$/g,"");
    if (!clean) throw new Error("テンプレート名を入力してください。");
    const path = rootPath() + "/templates/" + clean + ".txt";
    await ensureFolder(path.split("/").slice(0,-1).join("/"));
    const saved = await uploadText(path, text||"", null, true);
    await idbPut({path:saved.path_display, kind:"template", text:text||"", rev:saved.rev, server_modified:saved.server_modified||null, cached_at:Date.now()});
    return saved;
  }

  function disconnect() {
    setTokenState(null);
  }

  return {
    appKey, setAppKey, rootPath,
    getRole, setRole,
    getRedirectUri,
    isConnected, online,
    beginLogin, finishLoginFromCallback, disconnect,
    initializeFolders,
    loadArticles, loadTemplates,
    hydrateImages,
    saveExisting, createArticle, createTemplate,
    listArticleTypes, createArticleType,
    syncTextData,
    async diagnostic() {
      const entries = await listAll();
      const files = entries.filter(e => e[".tag"] === "file");
      const txt = files.filter(e => /\.txt$/i.test(e.path_display || e.name || ""));
      const articleTxt = txt.filter(e => /\/articles\//i.test(e.path_display || ""));
      const cached = await idbAll();
      const cachedArticles = cached.filter(r => r.kind === "text" && /\/articles\//i.test(r.path || ""));
      const parsed = cachedArticles.map(r => articleRowFromRecord({...r, path_display:r.path})).filter(Boolean);
      return {
        totalEntries: entries.length,
        totalFiles: files.length,
        txtFiles: txt.length,
        articleTxtFiles: articleTxt.length,
        cachedArticleFiles: cachedArticles.length,
        parsedArticles: parsed.length,
        samplePaths: articleTxt.slice(0, 8).map(e => e.path_display)
      };
    },

    async deepDiagnostic() {
      const steps = [];
      try {
        steps.push("1. Dropboxファイル一覧取得: 開始");
        const entries = await listAll();
        const articleTxt = entries.filter(e =>
          e[".tag"] === "file" &&
          /\/articles\//i.test(e.path_display || "") &&
          /\.txt$/i.test(e.path_display || "")
        );
        steps.push("1. Dropboxファイル一覧取得: 成功 (" + articleTxt.length + "件)");

        if (!articleTxt.length) {
          return { ok:false, steps, error:"articles配下のtxtが0件です。" };
        }

        const sample = articleTxt[0];
        steps.push("2. 診断対象: " + sample.path_display);

        steps.push("3. Dropbox本文ダウンロード: 開始");
        const downloaded = await download(sample.path_display, false);
        steps.push("3. Dropbox本文ダウンロード: 成功");

        const content = downloaded.content;
        steps.push("4. 文字列化確認: " + (typeof content === "string" ? "成功" : "失敗"));
        if (typeof content !== "string") {
          return { ok:false, steps, error:"ダウンロード内容が文字列ではありません。" };
        }
        steps.push("   文字数: " + content.length);

        steps.push("5. IndexedDB保存: 開始");
        await idbPut({
          path: sample.path_display,
          kind: "text",
          text: content,
          rev: downloaded.meta?.rev || sample.rev || null,
          server_modified: downloaded.meta?.server_modified || sample.server_modified || null,
          cached_at: Date.now(),
          diagnostic: true
        });
        steps.push("5. IndexedDB保存: 成功");

        steps.push("6. IndexedDB再読込: 開始");
        const reread = await idbGet(sample.path_display);
        if (!reread) {
          steps.push("6. IndexedDB再読込: 失敗");
          return { ok:false, steps, error:"保存直後にIndexedDBから読み戻せませんでした。" };
        }
        steps.push("6. IndexedDB再読込: 成功");
        steps.push("   再読込文字数: " + String(reread.text || "").length);

        steps.push("7. Wiki記事変換: 開始");
        const row = articleRowFromRecord({...reread, path_display:reread.path});
        if (!row) {
          steps.push("7. Wiki記事変換: 失敗");
          return { ok:false, steps, error:"キャッシュ済みtxtをWiki記事へ変換できませんでした。" };
        }
        steps.push("7. Wiki記事変換: 成功");
        steps.push("   論理記事名: " + row.logicalTitle);

        return {
          ok:true,
          steps,
          samplePath:sample.path_display,
          logicalTitle:row.logicalTitle
        };
      } catch (e) {
        steps.push("エラー発生");
        return {
          ok:false,
          steps,
          error:e?.message || String(e),
          status:e?.status || null
        };
      }
    }
  };
})();
