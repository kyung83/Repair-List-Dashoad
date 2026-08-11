import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AppNav from "./app-nav";
import "./globals.css";
import "./professional-shell.css";
import "./northern-brand.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Northern Logistics Fleet Operations",
  description: "Northern Logistics fleet repair, DVIR, PM, work orders, inventory, reporting, labor, and equipment operations.",
  other: { "codex-preview": "development" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AppNav />
        <script dangerouslySetInnerHTML={{ __html: `(function(){
          var APP_TIME_ZONE='America/Detroit';
          if(!window.__northernEasternTimePatched){
            window.__northernEasternTimePatched=true;
            ['toLocaleString','toLocaleDateString','toLocaleTimeString'].forEach(function(methodName){
              var original=Date.prototype[methodName];
              if(typeof original!=='function')return;
              Date.prototype[methodName]=function(locales,options){
                var resolvedLocales=locales===undefined?'en-US':locales;
                var resolvedOptions=Object.assign({},options||{});
                if(!resolvedOptions.timeZone)resolvedOptions.timeZone=APP_TIME_ZONE;
                return original.call(this,resolvedLocales,resolvedOptions);
              };
            });
          }
          function verifyPhotoLinks(root){
            var links=[];
            if(root instanceof HTMLAnchorElement && root.matches('a[href^="/photos?defectId="]')) links.push(root);
            if(root && root.querySelectorAll) links=links.concat(Array.from(root.querySelectorAll('a[href^="/photos?defectId="]')));
            links.forEach(function(link){
              if(!(link instanceof HTMLAnchorElement) || link.dataset.photoVerified) return;
              link.dataset.photoVerified='checking';
              link.hidden=true;
              var defectId='';
              try{ defectId=new URL(link.href,window.location.origin).searchParams.get('defectId')||''; }catch(_error){}
              if(!defectId){ link.remove(); return; }
              fetch('/api/geotab-photo-ids?defectId='+encodeURIComponent(defectId),{cache:'no-store'})
                .then(function(response){ return response.ok?response.json():{ids:[]}; })
                .then(function(payload){
                  var ids=Array.isArray(payload.ids)?payload.ids.map(String).map(function(id){return id.trim();}).filter(Boolean):[];
                  if(!ids.length){ link.remove(); return; }
                  link.href='geotab-media:'+Array.from(new Set(ids)).join(',');
                  link.dataset.photoVerified='yes';
                  link.hidden=false;
                })
                .catch(function(){ link.remove(); });
            });
          }
          function startPhotoVerifier(){
            verifyPhotoLinks(document);
            if(!document.body) return;
            new MutationObserver(function(records){
              records.forEach(function(record){
                record.addedNodes.forEach(function(node){ if(node instanceof Element) verifyPhotoLinks(node); });
              });
            }).observe(document.body,{childList:true,subtree:true});
          }
          if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',startPhotoVerifier,{once:true}); else startPhotoVerifier();
          document.addEventListener('click',function(event){
            var target=event.target;
            if(!(target instanceof Element))return;
            var link=target.closest('a[href^="geotab-media:"]');
            if(!link)return;
            event.preventDefault();
            var raw=link.getAttribute('href')||'';
            var ids=raw.slice('geotab-media:'.length);
            if(ids){window.open('/photos?ids='+encodeURIComponent(ids),'_blank','noopener,noreferrer');}
          });
        })();` }} />
        {children}
      </body>
    </html>
  );
}
