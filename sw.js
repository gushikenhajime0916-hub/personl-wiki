const CACHE="personal-wiki-mobile-v21";
const APP_SHELL=["./","./index.html","./style.css?v=mobile210","./storage.js?v=mobile210","./app.js?v=mobile210","./manifest.webmanifest?v=mobile210"];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(APP_SHELL)))});
self.addEventListener("activate",e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);if(u.hostname.includes("dropboxapi.com")||u.hostname.includes("dropbox.com"))return;e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request)))})