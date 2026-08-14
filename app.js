const VERSION="2.0.8 Mobile";
const state={articles:new Map(),logicalIndex:new Map(),meta:new Map(),current:null,refs:[],refGroups:new Map(),pageSearchMatches:[],pageSearchIndex:-1};
let editorMode="edit";
const $=id=>document.getElementById(id);
const norm=s=>String(s??"").trim().normalize("NFKC");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slug=s=>"h-"+norm(s).replace(/\s+/g,"-").replace(/[^\p{L}\p{N}\-_]/gu,"");

let WikiTemplates=new Map();
async function load(){
 let rows=[];
 try{
   await WikiStorage.finishLoginFromCallback();
   rows=await WikiStorage.loadArticles();
   WikiTemplates=await WikiStorage.loadTemplates();
 }catch(e){
   console.error(e);
   setCloudStatus("読込エラー");
   window.__lastDropboxError = e;
 }
 state.articles.clear();state.logicalIndex.clear();state.meta.clear();
 rows.forEach(r=>{const k=r.logicalTitle||r.title;state.articles.set(k,r.text);state.logicalIndex.set(norm(k),k);state.meta.set(k,r)});
 renderSidebar();showHome();updateCloudStatus();
}
function resolve(t){return state.logicalIndex.get(norm(t))||null}
function resolveRelative(t){
 if(!state.current)return resolve(t);
 if(t.startsWith("/")){
   const parent=state.current.split("/").slice(0,-1);
   return resolve([...parent,t.slice(1)].filter(Boolean).join("/"));
 }
 return resolve(t);
}
function headingsOf(title){const out=[];for(const l of (state.articles.get(title)||"").split(/\r?\n/)){const m=l.match(/^(={1,6})\s*(.*?)\s*\1\s*$/);if(m)out.push(norm(m[2]));}return out}
function cats(text){return [...text.matchAll(/\[\[カテゴリ:([^\]]+)\]\]/g)].map(m=>norm(m[1]))}
function links(text){return [...text.matchAll(/\[\[([^|\]#]+)(?:#[^|\]]+)?(?:\|[^\]]+)?\]\]/g)].map(m=>norm(m[1])).filter(x=>!x.startsWith("カテゴリ:")&&!x.startsWith("ファイル:"))}
function backlinks(t){const out=[];for(const [title,text] of state.articles){if(title!==t&&links(text).some(x=>(resolveRelative(x)||x)===t))out.push(title)}return out}
function related(t){const text=state.articles.get(t)||"",cc=new Set(cats(text)),cl=new Set(links(text)),score=new Map();for(const[o,ot]of state.articles){if(o===t)continue;let s=0,oc=new Set(cats(ot)),ol=new Set(links(ot));for(const c of cc)if(oc.has(c))s+=2;if(cl.has(o))s+=3;if(ol.has(t))s+=3;for(const l of cl)if(ol.has(l))s+=1;if(s)score.set(o,s)}return [...score].sort((a,b)=>b[1]-a[1]).slice(0,10).map(x=>x[0])}

function protectCode(text){const stash=[];text=text.replace(/<pre>([\s\S]*?)<\/pre>/g,(_,x)=>{const token=`@@PRE${stash.length}@@`;stash.push([token,`<pre class="wiki-code-block"><code>${esc(x)}</code></pre>`]);return token});text=text.replace(/<code>([\s\S]*?)<\/code>/g,(_,x)=>{const token=`@@CODE${stash.length}@@`;stash.push([token,`<code class="wiki-inline-code">${esc(x)}</code>`]);return token});return{text,stash}}
function restoreCode(text,stash){for(const[t,h]of stash)text=text.replaceAll(t,h);return text}

function splitTemplateArgs(inner){
 const parts=[];let cur="",depth=0;
 for(let i=0;i<inner.length;i++){
   if(inner.slice(i,i+2)==="{{"){depth++;cur+="{{";i++;continue}
   if(inner.slice(i,i+2)==="}}"&&depth>0){depth--;cur+="}}";i++;continue}
   if(inner[i]==="|"&&depth===0){parts.push(cur);cur="";continue}
   cur+=inner[i]
 }
 parts.push(cur);return parts
}
function expandTemplates(raw,depth=0){
 if(depth>6||!WikiTemplates?.size)return raw;
 let out="",i=0;
 while(i<raw.length){
   const s=raw.indexOf("{{",i);
   if(s<0){out+=raw.slice(i);break}
   out+=raw.slice(i,s);
   let d=1,j=s+2;
   while(j<raw.length&&d){
     if(raw.slice(j,j+2)==="{{"){d++;j+=2;continue}
     if(raw.slice(j,j+2)==="}}"){d--;j+=2;if(!d)break;continue}
     j++
   }
   if(d){out+=raw.slice(s);break}
   const whole=raw.slice(s,j),inner=whole.slice(2,-2),parts=splitTemplateArgs(inner);
   const name=(parts.shift()||"").trim();
   if(!WikiTemplates.has(name)){out+=whole;i=j;continue}
   const vars={};let pos=1;
   for(const a of parts){const eq=a.indexOf("=");if(eq>0)vars[a.slice(0,eq).trim()]=a.slice(eq+1).trim();else vars[String(pos++)]=a.trim()}
   let body=WikiTemplates.get(name);
   body=body.replace(/\{\{([A-Za-z0-9_\-\u3040-\u30ff\u3400-\u9fff]+)\}\}/g,(m,k)=>Object.prototype.hasOwnProperty.call(vars,k)?vars[k]:m);
   out+=expandTemplates(body,depth+1);i=j
 }
 return out
}

const LANG={"ja":"lang-ja","zh":"lang-zh","zh-cn":"lang-zh-cn","zh-tw":"lang-zh-tw","en":"lang-en","ipa":"lang-ipa"};
const G={alpha:"α",beta:"β",gamma:"γ",delta:"δ",epsilon:"ε",theta:"θ",lambda:"λ",mu:"μ",pi:"π",sigma:"σ",phi:"φ",omega:"ω",Gamma:"Γ",Delta:"Δ",Theta:"Θ",Lambda:"Λ",Pi:"Π",Sigma:"Σ",Phi:"Φ",Omega:"Ω"};
function readGroup(s,p){if(s[p]==="{"){let d=1,i=p+1,st=i;while(i<s.length&&d){if(s[i]==="{")d++;else if(s[i]==="}")d--;i++}return{value:s.slice(st,i-1),next:i}}return{value:s[p]||"",next:p+1}}
function mathExpr(e){let o="",i=0;while(i<e.length){if(e.startsWith("\\frac",i)){i+=5;let a=readGroup(e,i);i=a.next;let b=readGroup(e,i);i=b.next;o+=`<span class="math-frac"><span class="math-num">${mathExpr(a.value)}</span><span class="math-den">${mathExpr(b.value)}</span></span>`;continue}if(e[i]==="^"||e[i]==="_"){const sup=e[i]==="^";i++;let g=readGroup(e,i);i=g.next;o+=sup?`<sup class="math-script">${mathExpr(g.value)}</sup>`:`<sub class="math-script">${mathExpr(g.value)}</sub>`;continue}if(e[i]==="\\"){const m=e.slice(i+1).match(/^[A-Za-z]+/);if(m){const c=m[0];i+=c.length+1;if(c==="times"){o+="×";continue}if(c==="div"){o+="÷";continue}if(G[c]){o+=G[c];continue}}}o+=esc(e[i]);i++}return o}
function renderMath(x,block=false){return `<span class="wiki-math ${block?"wiki-math-block":"wiki-math-inline"}">${mathExpr(x.trim())}</span>`}

function captionInline(text,current){
 const p=protectCode(text);text=p.text;
 text=text.replace(/<math>([\s\S]*?)<\/math>/gi,(_,x)=>renderMath(x,false))
 .replace(/\{\{lang\|([^|}]+)\|([\s\S]*?)\}\}/gi,(_,c,b)=>`<span class="${LANG[String(c).toLowerCase()]||"lang-ja"}">${b}</span>`)
 .replace(/<br\s*\/?>/gi,"<br>")
 .replace(/<s>([\s\S]*?)<\/s>/gi,'<span class="wiki-strike">$1</span>')
 .replace(/<sup>([\s\S]*?)<\/sup>/gi,'<span class="wiki-sup">$1</span>')
 .replace(/<sub>([\s\S]*?)<\/sub>/gi,'<span class="wiki-sub">$1</span>')
 .replace(/'''''(.*?)'''''/g,"<strong><em>$1</em></strong>")
 .replace(/'''(.*?)'''/g,"<strong>$1</strong>")
 .replace(/''(.*?)''/g,"<em>$1</em>");
 text=text.replace(/\[\[([^|\]#]*)(?:#([^|\]]+))?(?:\|([^\]]+))?\]\]/g,(_,tr,hr,lr)=>{const t=tr.trim(),r=t?resolveRelative(t):current,label=(lr||hr||t||current).trim();if(!r)return `<a href="#" class="internal redlink" data-target="${esc(t)}">${esc(label)}</a>`;return `<a href="#" class="internal" data-target="${esc(r)}"${hr?` data-heading="${esc(hr.trim())}"`:""}>${esc(label)}</a>`});
 text=text.replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g,'<a href="$1" target="_blank" rel="noopener">$2</a>');
 return restoreCode(text,p.stash);
}
function parseImage(inside,current){const parts=inside.split("|").map(x=>x.trim()).filter(Boolean),file=parts.shift();let thumb=false,width=null,cap="";for(const p of parts){if(p==="thumb")thumb=true;else if(/^\d+px$/.test(p))width=parseInt(p);else cap=p}const capHtml=captionInline(cap,current);if(thumb)return `<figure class="figure-center"><img data-wiki-image="${esc(file)}" alt="${esc(cap||file)}"><figcaption>${capHtml}</figcaption></figure>`;return `<figure class="figure-large"${width?` style="max-width:min(${width}px,100%)"`:""}><img data-wiki-image="${esc(file)}" alt="${esc(cap||file)}"><figcaption>${capHtml}</figcaption></figure>`}

function addRef(name,body){
 if(name){
   if(!state.refGroups.has(name))state.refGroups.set(name,[]);
   const arr=state.refGroups.get(name);arr.push(body.trim());
   return {group:name,index:arr.length,label:`${name}${arr.length}`};
 }
 state.refs.push(body.trim());return {group:"",index:state.refs.length,label:String(state.refs.length)};
}
function inline(text,current){
 const p=protectCode(text);text=p.text;
 text=text.replace(/<!--[\s\S]*?-->/g,"");
 text=text.replace(/<ref(?:\s+name=["']([^"']+)["'])?>([\s\S]*?)<\/ref>/gi,(_,name,body)=>{const r=addRef(name,body);return `<sup><a href="#" class="ref-popup-trigger" data-ref-group="${esc(r.group)}" data-ref-index="${r.index}">[${esc(r.label)}]</a></sup>`});
 text=text.replace(/<math>([\s\S]*?)<\/math>/gi,(_,x)=>renderMath(x,false));
 text=text.replace(/\{\{lang\|([^|}]+)\|([\s\S]*?)\}\}/gi,(_,c,b)=>`<span class="${LANG[String(c).toLowerCase()]||"lang-ja"}">${b}</span>`);
 text=text.replace(/<br\s*\/?>/gi,"<br>").replace(/<s>([\s\S]*?)<\/s>/gi,'<span class="wiki-strike">$1</span>').replace(/<sup>([\s\S]*?)<\/sup>/gi,'<span class="wiki-sup">$1</span>').replace(/<sub>([\s\S]*?)<\/sub>/gi,'<span class="wiki-sub">$1</span>');
 text=text.replace(/'''''(.*?)'''''/g,"<strong><em>$1</em></strong>").replace(/'''(.*?)'''/g,"<strong>$1</strong>").replace(/''(.*?)''/g,"<em>$1</em>");
 text=text.replace(/\[\[ファイル:([^\]]+)\]\]/g,(_,x)=>parseImage(x,current));
 text=text.replace(/\[\[([^|\]#]*)(?:#([^|\]]+))?(?:\|([^\]]+))?\]\]/g,(_,tr,hr,lr)=>{const t=tr.trim();if(t.startsWith("カテゴリ:"))return `[[${esc(t)}]]`;const r=t?resolveRelative(t):current,label=(lr||hr||t||current).trim();if(!r)return `<a href="#" class="internal redlink" data-target="${esc(t)}">${esc(label)}</a>`;const bad=hr&&!headingsOf(r).includes(norm(hr));return `<a href="#" class="internal ${bad?"badsection":""}" data-target="${esc(r)}"${hr?` data-heading="${esc(hr.trim())}"`:""}>${esc(label)}</a>`});
 text=text.replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g,'<a href="$1" target="_blank" rel="noopener">$2</a>');
 return restoreCode(text,p.stash);
}

function parseCell(line,head){let body=line.replace(head?/^\s*!\s*/:/^\s*\|\s*/,""),attrs={},txt=body;const pipe=body.indexOf("|");if(pipe>=0){const a=body.slice(0,pipe).trim();if(/(?:align|colspan|rowspan|scope)\s*=/.test(a)){txt=body.slice(pipe+1).trim();for(const m of a.matchAll(/\b(align|colspan|rowspan|scope)\s*=\s*["']?([^"'\s]+)["']?/gi))attrs[m[1].toLowerCase()]=m[2]}}const hs=[];if(["left","center","right"].includes((attrs.align||"").toLowerCase()))hs.push(`class="cell-align-${attrs.align.toLowerCase()}"`);if(/^\d+$/.test(attrs.colspan||""))hs.push(`colspan="${parseInt(attrs.colspan)}"`);if(/^\d+$/.test(attrs.rowspan||""))hs.push(`rowspan="${parseInt(attrs.rowspan)}"`);if(["col","row"].includes((attrs.scope||"").toLowerCase()))hs.push(`scope="${attrs.scope.toLowerCase()}"`);return{attrs:hs.join(" "),txt}}
function renderNestedList(lines,title){
 let html="",stack=[];
 for(const raw of lines){
   const m=raw.match(/^(\*+|#+)\s+(.*)$/);if(!m)continue;
   const depth=m[1].length,tag=m[1][0]==="#"?"ol":"ul";
   while(stack.length>depth)html+="</li></"+stack.pop()+">";
   if(stack.length===depth&&stack.length)html+="</li><li>";
   while(stack.length<depth){html+=`<${tag} class="wiki-list"><li>`;stack.push(tag)}
   html+=inline(m[2],title);
 }
 while(stack.length)html+="</li></"+stack.pop()+">";
 return html;
}

function refsHtml(){
 let h="";
 if(state.refs.length)h+=`<section class="ref-group"><h3>脚注</h3><ol>${state.refs.map((x,i)=>`<li>[${i+1}] ${inline(x,state.current)}</li>`).join("")}</ol></section>`;
 for(const[name,arr]of state.refGroups)h+=`<section class="ref-group"><h3>${esc(name)}</h3><ol>${arr.map((x,i)=>`<li>[${esc(name)}${i+1}] ${inline(x,state.current)}</li>`).join("")}</ol></section>`;
 return h?`<section class="box"><h2>脚注</h2>${h}</section>`:"";
}
function autoHtml(t){const a=related(t);return `<details class="auto"><summary>関連項目（自動生成）</summary>${a.length?`<ul>${a.map(x=>`<li><a href="#" class="internal" data-target="${esc(x)}">${esc(x)}</a></li>`).join("")}</ul>`:"<p>関連項目はありません。</p>"}</details>`}
function breadcrumbs(title){const m=state.meta.get(title);if(!m||m.section!=="main"||!m.pathParts?.length)return "";const items=[];for(let i=0;i<m.pathParts.length;i++){const logical=m.pathParts.slice(0,i+1).join("/"),r=resolve(logical);items.push(r?`<a href="#" class="internal" data-target="${esc(r)}">${esc(m.pathParts[i])}</a>`:`<span>${esc(m.pathParts[i])}</span>`)}return `<nav class="breadcrumbs">${items.join('<span class="sep">›</span>')}</nav>`}

function parseTable(lines,title,start){
 let h="<table class='wikitable'>",i=start+1,rowOpen=false,cell=null;
 function closeCell(){if(cell){h+=parse(cell.text.join("\n"),title,true,true)+`</${cell.tag}>`;cell=null}}
 while(i<lines.length&&!/^\s*\|\}/.test(lines[i])){
   const x=lines[i];
   if(/^\s*\|\+/.test(x)){closeCell();h+=`<caption>${captionInline(x.replace(/^\s*\|\+\s*/,""),title)}</caption>`;i++;continue}
   if(/^\s*\|-/.test(x)){closeCell();if(rowOpen)h+="</tr>";h+="<tr>";rowOpen=true;i++;continue}
   if(/^\s*!/.test(x)||/^\s*\|/.test(x)){
     closeCell();if(!rowOpen){h+="<tr>";rowOpen=true}
     const head=/^\s*!/.test(x),c=parseCell(x,head),tag=head?"th":"td";
     h+=`<${tag}${c.attrs?" "+c.attrs:""}>`;cell={tag,text:[c.txt]};i++;continue
   }
   if(cell)cell.text.push(x);
   i++;
 }
 closeCell();if(rowOpen)h+="</tr>";h+="</table>";return{html:h,next:i+1};
}

function parse(raw,title,isFrag=false,inCell=false){
 if(!isFrag){state.refs=[];state.refGroups=new Map()}
 let cs=[],heads=[],out=[],i=0,lines=raw.replace(/\r\n?/g,"\n").split("\n");
 if(!isFrag)lines=lines.filter(l=>{const m=l.match(/^\s*\[\[カテゴリ:([^\]]+)\]\]\s*$/);if(m){cs.push(norm(m[1]));return false}return true});
 while(i<lines.length){
   const l=lines[i];
   if(/^\s*<!--/.test(l)){while(i<lines.length&&!/-->/.test(lines[i]))i++;i++;continue}
   if(!inCell&&/^\s*\{\|\s*class=["']?wikitable/.test(l)){const t=parseTable(lines,title,i);out.push(t.html);i=t.next;continue}
   if(inCell&&/^\s*\{\|/.test(l)){out.push('<div class="syntax-error">Wiki構文エラー：表の中に表を入れることはできません。</div>');i++;continue}
   if(inCell&&/^\s*<columns>/.test(l)){out.push('<div class="syntax-error">Wiki構文エラー：表のセル内では段組みを使用できません。</div>');i++;continue}
   if(/^\s*<math\s+display=["']block["']\s*>/i.test(l)){let b=[l.replace(/^\s*<math\s+display=["']block["']\s*>/i,"")];i++;while(i<lines.length&&!/<\/math>\s*$/i.test(lines[i])){b.push(lines[i]);i++}if(i<lines.length)b.push(lines[i].replace(/<\/math>\s*$/i,""));out.push(renderMath(b.join("\n"),true));i++;continue}
   if(!inCell&&/^\s*<columns>\s*$/.test(l)){const cols=[];i++;while(i<lines.length&&!/^\s*<\/columns>\s*$/.test(lines[i])){const st=lines[i];if(/^\s*<column(?:\s+[^>]*)?>\s*$/.test(st)){const wm=st.match(/width\s*=\s*["']?(\d{1,3})%/i),w=wm?Math.max(10,Math.min(90,parseInt(wm[1]))):null,b=[];i++;while(i<lines.length&&!/^\s*<\/column>\s*$/.test(lines[i])){b.push(lines[i]);i++}cols.push({w,h:parse(b.join("\n"),title,true,false)});if(i<lines.length)i++;continue}i++}if(i<lines.length)i++;out.push(`<div class="wiki-columns">${cols.map(c=>`<div class="wiki-column"${c.w?` style="flex:0 1 ${c.w}%;max-width:${c.w}%"`:""}>${c.h}</div>`).join("")}</div>`);continue}
   if(/^\s*<pre>/.test(l)){let b=[l.replace(/^\s*<pre>/,"")];i++;while(i<lines.length&&!/<\/pre>\s*$/.test(lines[i])){b.push(lines[i]);i++}if(i<lines.length)b.push(lines[i].replace(/<\/pre>\s*$/,""));out.push(`<pre class="wiki-code-block"><code>${esc(b.join("\n"))}</code></pre>`);i++;continue}
   if(/^\s*<blockquote>/.test(l)){let b=[l.replace(/^\s*<blockquote>/,"")];i++;while(i<lines.length&&!/<\/blockquote>\s*$/.test(lines[i])){b.push(lines[i]);i++}if(i<lines.length)b.push(lines[i].replace(/<\/blockquote>\s*$/,""));out.push(`<blockquote class="wiki-quote">${inline(b.join("<br>"),title)}</blockquote>`);i++;continue}
   if(/^\s*\{\{関連項目\(自動生成\)\}\}\s*$/.test(l)){out.push("__AUTO__");i++;continue}
   if(/^\s*\{\{Reflist\}\}\s*$/.test(l)){out.push("__REFS__");i++;continue}
   if(/^\s*;/.test(l)){let h="<dl>";while(i<lines.length&&(/^\s*;/.test(lines[i])||/^\s*:/.test(lines[i]))){h+=/^\s*;/.test(lines[i])?`<dt>${inline(lines[i].replace(/^\s*;\s*/,""),title)}</dt>`:`<dd>${inline(lines[i].replace(/^\s*:\s*/,""),title)}</dd>`;i++}out.push(h+"</dl>");continue}
   if(/^\s*(\*+|#+)\s+/.test(l)){const b=[];while(i<lines.length&&/^\s*(\*+|#+)\s+/.test(lines[i])){b.push(lines[i].trimStart());i++}out.push(renderNestedList(b,title));continue}
   const m=l.match(/^(={1,6})\s*(.*?)\s*\1\s*$/);
   if(m){const lvl=Math.min(6,m[1].length+1),txt=m[2].trim(),id=slug(txt);if(!inCell)heads.push({n:m[1].length,txt,id});out.push(`<h${lvl} id="${id}">${inline(txt,title)}</h${lvl}>`);i++;continue}
   if(!l.trim()){out.push("");i++;continue}
   const para=[l];i++;while(i<lines.length&&lines[i].trim()&&!/^(={1,6})/.test(lines[i])&&!/^\s*(\*+|#+)\s+/.test(lines[i])&&!/^\s*[;:]/.test(lines[i])&&!/^\s*\{\|/.test(lines[i])&&!/^\s*\{\{/.test(lines[i])&&!/^\s*<pre>/.test(lines[i])&&!/^\s*<blockquote>/.test(lines[i])&&!/^\s*<columns>/.test(lines[i])){para.push(lines[i]);i++}out.push(`<p>${inline(para.join(" "),title)}</p>`);
 }
 let body=out.join("\n").replace("__AUTO__",autoHtml(title)).replace("__REFS__",refsHtml());
 if(!isFrag&&heads.length)body=`<details class="toc"><summary>目次</summary><ul>${heads.map(h=>`<li style="margin-left:${(h.n-1)*14}px"><a href="#${h.id}">${esc(h.txt)}</a></li>`).join("")}</ul></details>`+body;
 if(isFrag)return body;
 const bl=backlinks(title);if(bl.length)body+=`<section class="box"><h2>このページへのリンク</h2><ul>${bl.map(x=>`<li><a href="#" class="internal" data-target="${esc(x)}">${esc(x)}</a></li>`).join("")}</ul></section>`;
 if(cs.length)body+=`<section class="box"><strong>カテゴリ：</strong>${cs.map(c=>`<button class="pill" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}</section>`;
 const mt=state.meta.get(title);return `${breadcrumbs(title)}<h1>${esc(mt?.title||title)}</h1>${body}`;
}

function ensureRefPopup(){let p=$("refPopup");if(p)return p;p=document.createElement("div");p.id="refPopup";p.className="ref-popup";p.innerHTML='<button class="ref-popup-close">×</button><div class="ref-popup-title"></div><div class="ref-popup-body"></div>';document.body.appendChild(p);p.querySelector(".ref-popup-close").onclick=()=>p.classList.remove("open");return p}
function openRefPopup(a,group,index){const p=ensureRefPopup();let body="",label="";if(group){const arr=state.refGroups.get(group)||[];body=arr[index-1]||"";label=`${group}${index}`}else{body=state.refs[index-1]||"";label=String(index)}p.querySelector(".ref-popup-title").textContent=`脚注 ${label}`;p.querySelector(".ref-popup-body").innerHTML=inline(body,state.current);p.classList.add("open");const q=a.getBoundingClientRect();p.style.left=`${Math.max(8,window.scrollX+q.left)}px`;p.style.top=`${window.scrollY+q.bottom+8}px`;bindWithin(p)}
function closeRef(){const p=$("refPopup");if(p)p.classList.remove("open")}
function bindWithin(root=document){root.querySelectorAll(".internal").forEach(a=>a.onclick=e=>{e.preventDefault();closeRef();if(a.classList.contains("redlink"))return;openArticle(a.dataset.target);if(a.dataset.heading)setTimeout(()=>document.getElementById(slug(a.dataset.heading))?.scrollIntoView({behavior:"smooth"}),50)});root.querySelectorAll("[data-cat]").forEach(b=>b.onclick=()=>showCategory(b.dataset.cat));root.querySelectorAll(".ref-popup-trigger").forEach(a=>a.onclick=e=>{e.preventDefault();e.stopPropagation();openRefPopup(a,a.dataset.refGroup||"",parseInt(a.dataset.refIndex))})}
function bind(){bindWithin(document)}
async function openArticle(t){closeRef();state.current=t;$("current").textContent=t;const expanded=expandTemplates(state.articles.get(t)||"");$("view").innerHTML=parse(expanded,t,false,false);bind();resetPageSearch();await WikiStorage.hydrateImages($("view"));updateEditAvailability();window.scrollTo(0,0)}
function allCategories(){const s=new Set();for(const[,x]of state.articles)for(const c of cats(x))s.add(c);return [...s].sort((a,b)=>a.localeCompare(b,"ja"))}
function sectionTitles(sec){return [...state.articles.keys()].filter(t=>(state.meta.get(t)?.section||"main")===sec).sort((a,b)=>a.localeCompare(b,"ja"))}
function cards(ts){return ts.length?`<div class="home-list">${ts.map(t=>`<div class="home-card"><a href="#" data-open="${esc(t)}">${esc(state.meta.get(t)?.title||t)}</a></div>`).join("")}</div>`:"<p>まだありません。</p>"}
function showHome(){state.current=null;$("current").textContent="ホーム";const main=sectionTitles("main"),help=sectionTitles("help"),cs=allCategories();$("view").innerHTML=`<h1>個人Wiki v${VERSION}</h1><section class="home-section"><h2>記事</h2>${cards(main)}</section><section class="home-section"><h2>カテゴリ</h2>${cs.length?`<div class="category-list">${cs.map(c=>`<button class="pill" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}</div>`:"<p>まだありません。</p>"}</section><section class="home-section"><h2>ヘルプ</h2>${cards(help)}</section><section class="home-section"><h2>保守</h2><button class="tool-entry" id="missingLinksBtn">リンク切れ一覧</button></section>`;document.querySelectorAll("[data-open]").forEach(a=>a.onclick=e=>{e.preventDefault();openArticle(a.dataset.open)});document.querySelectorAll("[data-cat]").forEach(b=>b.onclick=()=>showCategory(b.dataset.cat));$("missingLinksBtn").onclick=showMissingLinks}
function showCategory(c){state.current=null;$("current").textContent=`カテゴリ: ${c}`;const list=[...state.articles.entries()].filter(([,x])=>cats(x).includes(norm(c))).map(([t])=>t);$("view").innerHTML=`<h1>カテゴリ: ${esc(c)}</h1><ul>${list.map(t=>`<li><a href="#" class="internal" data-target="${esc(t)}">${esc(state.meta.get(t)?.title||t)}</a></li>`).join("")}</ul>`;bind()}
function showMissingLinks(){const misses=new Map();for(const[from,text]of state.articles){for(const l of links(text)){if(!resolveRelative(l)){if(!misses.has(l))misses.set(l,[]);misses.get(l).push(from)}}}const arr=[...misses].sort((a,b)=>a[0].localeCompare(b[0],"ja"));$("view").innerHTML=`<h1>リンク切れ一覧</h1>${arr.length?`<ul>${arr.map(([l,src])=>`<li><strong>${esc(l)}</strong> (${src.length}件)<ul>${src.map(s=>`<li><a href="#" class="internal" data-target="${esc(s)}">${esc(s)}</a></li>`).join("")}</ul></li>`).join("")}</ul>`:"<p>リンク切れはありません。</p>"}`;bind()}
function renderSidebar(){const main=sectionTitles("main"),help=sectionTitles("help"),byType={};for(const t of main){const m=state.meta.get(t),type=m?.articleType||"その他";(byType[type]??=[]).push(t)}const typeHtml=Object.entries(byType).map(([type,ts])=>`<div class="sidebar-type"><div class="sidebar-type-title">${esc(type)}</div>${ts.map(t=>`<button class="tree-item" style="--depth:${state.meta.get(t)?.pathParts?.length||0}" data-title="${esc(t)}">${esc(state.meta.get(t)?.title||t)}</button>`).join("")}</div>`).join("");$("articleList").innerHTML=`<details class="sidebar-group"><summary>記事</summary><div class="sidebar-group-list">${typeHtml||"まだありません。"}</div></details><details class="sidebar-group"><summary>ヘルプ</summary><div class="sidebar-group-list">${help.map(t=>`<button data-title="${esc(t)}">${esc(state.meta.get(t)?.title||t)}</button>`).join("")||"まだありません。"}</div></details>`;document.querySelectorAll("#articleList [data-title]").forEach(b=>b.onclick=()=>{openArticle(b.dataset.title);closeDrawer()})}
function search(q){const n=norm(q).toLowerCase(),rs=[];if(n)for(const[t,x]of state.articles){const y=norm(x).toLowerCase(),i=y.indexOf(n);if(i>=0)rs.push({t,s:x.replace(/\s+/g," ").slice(Math.max(0,i-35),i+100)})}$("results").innerHTML=rs.map(r=>`<div class="result"><button data-r="${esc(r.t)}">${esc(state.meta.get(r.t)?.title||r.t)}</button><div class="snippet">${esc(r.s)}</div></div>`).join("");document.querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>openArticle(b.dataset.r))}
function resetPageSearch(){state.pageSearchMatches=[];state.pageSearchIndex=-1;$("pageSearchStatus").textContent="";document.querySelectorAll("mark.wiki-find").forEach(m=>m.replaceWith(document.createTextNode(m.textContent)))}
function pageSearch(q){resetPageSearch();if(!q)return;const walker=document.createTreeWalker($("view"),NodeFilter.SHOW_TEXT),nodes=[];let n;while(n=walker.nextNode())if(!["SCRIPT","STYLE","CODE","PRE"].includes(n.parentElement?.tagName))nodes.push(n);const needle=q.toLowerCase();for(const node of nodes){const txt=node.nodeValue,low=txt.toLowerCase();let pos=0,idx,frag=document.createDocumentFragment(),found=false;while((idx=low.indexOf(needle,pos))>=0){found=true;frag.append(txt.slice(pos,idx));const m=document.createElement("mark");m.className="wiki-find";m.textContent=txt.slice(idx,idx+q.length);frag.append(m);pos=idx+q.length}if(found){frag.append(txt.slice(pos));node.parentNode.replaceChild(frag,node)}}state.pageSearchMatches=[...document.querySelectorAll("mark.wiki-find")];if(state.pageSearchMatches.length){state.pageSearchIndex=0;focusPageMatch()}else $("pageSearchStatus").textContent="0件"}
function focusPageMatch(){state.pageSearchMatches.forEach(m=>m.classList.remove("current"));if(state.pageSearchIndex<0)return;const m=state.pageSearchMatches[state.pageSearchIndex];m.classList.add("current");m.scrollIntoView({behavior:"smooth",block:"center"});$("pageSearchStatus").textContent=`${state.pageSearchIndex+1} / ${state.pageSearchMatches.length}`}
function movePageSearch(d){if(!state.pageSearchMatches.length)return;state.pageSearchIndex=(state.pageSearchIndex+d+state.pageSearchMatches.length)%state.pageSearchMatches.length;focusPageMatch()}

function setCloudStatus(s){const el=$("cloudStatus");if(el)el.textContent=s}
function updateCloudStatus(){
 const connected=WikiStorage.isConnected();
 setCloudStatus(connected?(navigator.onLine?"Dropbox接続中":"オフライン（キャッシュ閲覧）"):"Dropbox未接続");
 const key=$("dropboxAppKey");if(key&&!key.value)key.value=WikiStorage.appKey();
 const role=$("deviceRole");if(role)role.value=WikiStorage.getRole();
 const uri=$("redirectUri");if(uri)uri.textContent=WikiStorage.getRedirectUri();
 const btn=$("dropboxConnectBtn");if(btn)btn.textContent=connected?"Dropbox再接続":"Dropboxに接続"
}
function updateEditAvailability(){const can=!!state.current&&WikiStorage.isConnected()&&navigator.onLine;$("editBtn").disabled=!can}
async function beginEdit(){
 if(!state.current)return;
 if(!navigator.onLine){alert("オフライン中は編集できません。");return}
 editorMode="edit";
 $("newArticleMeta").classList.remove("open");
 $("editorTitle").textContent=state.current;
 $("editorText").value=state.articles.get(state.current)||"";
 $("editorMessage").textContent="";
 $("editor").classList.add("open");
}
function cancelEdit(){
 $("editor").classList.remove("open");
 $("editorMessage").textContent="";
 editorMode="edit";
}
async function saveEdit(){
 const text=$("editorText").value;

 if(editorMode==="create"){
   const title=$("newArticleTitle").value.trim();
   let type=$("newArticleType").value;

   if(!title){
     $("editorMessage").textContent="記事名を入力してください。";
     return;
   }

   if(type==="__new__"){
     const newType=$("newArticleTypeNew").value.trim();
     if(!newType){
       $("editorMessage").textContent="新しい記事種別名を入力してください。";
       return;
     }
     try{
       type=await WikiStorage.createArticleType(newType);
     }catch(e){
       $("editorMessage").textContent=e.message||"記事種別の作成に失敗しました。";
       return;
     }
   }

   $("editorMessage").textContent="新規記事を保存中…";
   try{
     await WikiStorage.createArticle(type,title,text);
     $("editor").classList.remove("open");
     editorMode="edit";
     await load();

     const key=resolve(title);
     if(key) await openArticle(key);
   }catch(e){
     $("editorMessage").textContent=e.message||"新規記事の保存に失敗しました。";
   }
   return;
 }

 if(!state.current)return;
 const meta=state.meta.get(state.current);
 $("editorMessage").textContent="保存中…";
 try{
   const saved=await WikiStorage.saveExisting(meta,text);
   state.articles.set(state.current,text);
   meta.rev=saved.rev;
   meta.server_modified=saved.server_modified||null;
   $("editorMessage").textContent="保存しました。";
   $("editor").classList.remove("open");
   await openArticle(state.current);
 }catch(e){
   $("editorMessage").textContent=e.message||"保存に失敗しました。";
 }
}

async function createArticleUi(){
 if(!navigator.onLine||!WikiStorage.isConnected()){
   alert("新規記事作成にはDropbox接続が必要です。");
   return;
 }

 editorMode="create";
 $("editorTitle").textContent="新規記事";
 $("editorMessage").textContent="";
 $("newArticleMeta").classList.add("open");
 $("newArticleTitle").value="";
 $("newArticleTypeNew").value="";
 $("newArticleTypeNewBox").classList.remove("open");

 let types=[];
 try{
   types=await WikiStorage.listArticleTypes();
 }catch(e){
   alert("記事種別の取得に失敗しました。\n"+(e.message||String(e)));
   return;
 }

 const sel=$("newArticleType");
 sel.innerHTML="";
 for(const t of types){
   const o=document.createElement("option");
   o.value=t;
   o.textContent=t;
   sel.appendChild(o);
 }
 const add=document.createElement("option");
 add.value="__new__";
 add.textContent="＋ 新しい記事種別";
 sel.appendChild(add);

 if(!types.length) sel.value="__new__";

 sel.onchange=()=>{
   $("newArticleTypeNewBox").classList.toggle("open",sel.value==="__new__");
 };
 $("newArticleTypeNewBox").classList.toggle("open",sel.value==="__new__");

 $("editorText").value="";
 $("editor").classList.add("open");
 $("newArticleTitle").focus();
}

async function createTemplateUi(){if(!navigator.onLine||!WikiStorage.isConnected()){alert("テンプレート作成にはDropbox接続が必要です。");return}const name=prompt("テンプレート名（例：book）","");if(!name)return;const sample="'''{{title}}'''<br>\\n著者：{{author}}<br>\\n出版社：{{publisher}}";const text=prompt("テンプレート本文。位置引数は {{1}}、名前付き引数は {{title}} など。",sample);if(text===null)return;try{await WikiStorage.createTemplate(name,text);await load()}catch(e){alert(e.message)}}
async function saveDropboxSettings(){WikiStorage.setAppKey($("dropboxAppKey").value);WikiStorage.setRole($("deviceRole").value);updateCloudStatus();alert("端末設定を保存しました。")}
async function initializeDropboxFolders(){try{await WikiStorage.initializeFolders();alert("Dropbox内にPersonalWikiの基本フォルダを作成しました。");await load()}catch(e){alert(e.message)}}

function openDrawer(){$("drawer").classList.add("open");$("backdrop").classList.add("show")}function closeDrawer(){$("drawer").classList.remove("open");$("backdrop").classList.remove("show")}
async function manualDropboxSync(){
  setCloudStatus("診断中…");
  try{
    const d=await WikiStorage.diagnostic();
    const deep=await WikiStorage.deepDiagnostic();

    let msg=
      "【通常診断】\n"+
      "API上の記事txt: "+d.articleTxtFiles+" 件\n"+
      "端末キャッシュ: "+d.cachedArticleFiles+" 件\n"+
      "Wiki記事として認識: "+d.parsedArticles+" 件\n\n"+
      "【1件詳細診断】\n"+
      deep.steps.join("\n");

    if(!deep.ok){
      msg+="\n\n【失敗理由】\n"+(deep.error||"不明なエラー");
      if(deep.status) msg+="\nHTTP status: "+deep.status;
    }else{
      msg+="\n\n詳細診断は最後まで成功しました。";
    }

    alert(msg);

    // 詳細診断後に通常同期をもう一度試す。
    await load();
    updateCloudStatus();
  }catch(e){
    console.error(e);
    setCloudStatus("診断エラー");
    alert("Dropbox診断エラー:\n"+(e.message||String(e))+"\n\nこの内容をそのまま教えてください。");
  }
  closeDrawer();
}
$("menu").onclick=openDrawer;$("backdrop").onclick=closeDrawer;$("homeBtn").onclick=()=>{showHome();closeDrawer()};$("reloadBtn").onclick=manualDropboxSync;$("searchBtn").onclick=()=>{$("search").classList.toggle("open");$("q").focus()};$("q").oninput=e=>search(e.target.value);
$("pageSearchBtn").onclick=()=>{$("pageSearch").classList.toggle("open");$("pageQ").focus()};$("pageSearchClose").onclick=()=>{$("pageSearch").classList.remove("open");resetPageSearch()};$("pageQ").oninput=e=>pageSearch(e.target.value);$("pagePrev").onclick=()=>movePageSearch(-1);$("pageNext").onclick=()=>movePageSearch(1);
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeRef();$("pageSearch").classList.remove("open")}});
$("editBtn").onclick=beginEdit;
$("editorSave").onclick=saveEdit;
$("editorCancel").onclick=cancelEdit;
$("newArticleBtn").onclick=createArticleUi;
$("newTemplateBtn").onclick=createTemplateUi;
$("dropboxSettingsSave").onclick=saveDropboxSettings;
$("dropboxConnectBtn").onclick=()=>WikiStorage.beginLogin().catch(e=>alert(e.message));
$("dropboxDisconnectBtn").onclick=()=>{WikiStorage.disconnect();updateCloudStatus();alert("この端末のDropbox接続情報を削除しました。")};
$("dropboxInitBtn").onclick=initializeDropboxFolders;
window.addEventListener("online",()=>{updateCloudStatus();updateEditAvailability()});
window.addEventListener("offline",()=>{updateCloudStatus();updateEditAvailability()});

load();
