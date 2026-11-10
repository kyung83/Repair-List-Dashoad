"use client";

import ShopPageV2 from "./page-v2";
import IndirectLaborLauncher from "./indirect-labor-launcher";
import ShopDutiesPanel from "./shop-duties-panel";

export default function ShopPage(){
  return <>
    <style>{`nav[aria-label="Current repair tools"]{display:none!important;}`}</style>
    <ShopDutiesPanel/>
    <IndirectLaborLauncher/>
    <ShopPageV2/>
  </>;
}
