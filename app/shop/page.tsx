"use client";

import ShopPageV2 from "./page-v2";
import IndirectLaborLauncher from "./indirect-labor-launcher";

export default function ShopPage(){
  return <>
    <style>{`nav[aria-label="Current repair tools"]{display:none!important;}`}</style>
    <ShopPageV2/>
    <IndirectLaborLauncher/>
  </>;
}
