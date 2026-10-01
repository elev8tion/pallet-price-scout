// Fictional fixture. No live analysis, retail research, or POS connection.
export const TIERS = [400, 600, 900, 1400];
export const PRODUCTS = [
  {id:'NIN-101', name:'Ninja air fryer', detail:'AF101 · 4 qt · black', category:'Kitchen', mark:'NI', price:100, qty:14, sold:48, days:3.2, stock:2, match:'exact', confidence:99, condition:'Ready', trend:[18,26,35,48]},
  {id:'JBL-FL6', name:'JBL Flip 6 speaker', detail:'Portable Bluetooth · black', category:'Electronics', mark:'JB', price:130, qty:10, sold:36, days:4.1, stock:1, match:'exact', confidence:98, condition:'Ready', trend:[14,22,28,36]},
  {id:'SHK-NV', name:'Shark upright vacuum', detail:'Navigator · NV360', category:'Home', mark:'SH', price:180, qty:8, sold:24, days:5.4, stock:1, match:'exact', confidence:98, condition:'Ready', trend:[10,12,18,24]},
  {id:'KEU-KM', name:'Keurig K-Mini', detail:'Single-serve coffee maker', category:'Kitchen', mark:'KE', price:80, qty:12, sold:30, days:4.8, stock:2, match:'exact', confidence:99, condition:'Ready', trend:[14,19,24,30]},
  {id:'COS-CS', name:'COSORI electric kettle', detail:'1.7 L · stainless steel', category:'Kitchen', mark:'CO', price:40, qty:18, sold:42, days:2.6, stock:4, match:'exact', confidence:97, condition:'Ready', trend:[17,28,32,42]},
  {id:'ANC-Q20', name:'Soundcore Q20 headphones', detail:'Over-ear · noise cancelling', category:'Electronics', mark:'AN', price:60, qty:16, sold:27, days:5.2, stock:1, match:'exact', confidence:98, condition:'Ready', trend:[9,17,22,27]},
  {id:'INS-DUO', name:'Instant Pot Duo', detail:'7-in-1 pressure cooker · 6 qt', category:'Kitchen', mark:'IP', price:100, qty:10, sold:7, days:18, stock:5, match:'exact', confidence:98, condition:'Ready', trend:[9,8,6,7]},
  {id:'LOD-12', name:'Lodge cast iron skillet', detail:'Pre-seasoned · 12 inch', category:'Kitchen', mark:'LO', price:30, qty:22, sold:9, days:16, stock:6, match:'exact', confidence:99, condition:'Ready', trend:[8,10,8,9]},
  {id:'LEVO-200', name:'Levoit air purifier', detail:'Core 200S · white', category:'Home', mark:'LE', price:90, qty:12, sold:5, days:22, stock:4, match:'exact', confidence:96, condition:'Ready', trend:[7,6,6,5]},
  {id:'OST-100', name:'Oster countertop blender', detail:'Classic series · glass jar', category:'Kitchen', mark:'OS', price:50, qty:16, sold:4, days:25, stock:6, match:'exact', confidence:96, condition:'Ready', trend:[6,5,5,4]},
  {id:'SUN-XL', name:'Sunbeam heated throw', detail:'Fleece · 50 × 60 inch', category:'Home', mark:'SU', price:40, qty:20, sold:3, days:28, stock:8, match:'exact', confidence:95, condition:'Ready', trend:[8,6,4,3]},
  {id:'RUB-20', name:'Rubbermaid food storage', detail:'Easy Find Lids · 20-piece', category:'Home', mark:'RU', price:20, qty:30, sold:11, days:14, stock:8, match:'exact', confidence:98, condition:'Ready', trend:[10,12,10,11]},
  {id:'BEL-15', name:'Belkin wireless charger', detail:'15 W charging pad', category:'Electronics', mark:'BE', price:30, qty:18, sold:0, days:null, stock:0, match:'new', confidence:97, condition:'Ready', trend:[0,0,0,0]},
  {id:'UNK-01', name:'Unidentified countertop appliance', detail:'Model label obscured', category:'Kitchen', mark:'??', price:null, qty:3, sold:0, days:null, stock:0, match:'review', confidence:62, condition:'Review', trend:[0,0,0,0]},
  {id:'DY-V8', name:'Dyson cordless vacuum', detail:'Possible V8 · variant unconfirmed', category:'Home', mark:'DY', price:300, qty:2, sold:20, days:4, stock:0, match:'review', confidence:73, condition:'Review', trend:[9,12,16,20]},
  {id:'HAM-T2', name:'Hamilton Beach toaster', detail:'2-slice · damaged packaging', category:'Kitchen', mark:'HB', price:30, qty:4, sold:6, days:15, stock:2, match:'exact', confidence:95, condition:'Review', trend:[5,8,6,6]}
];
export const byId = id => PRODUCTS.find(p => p.id === id);
export const cents = dollars => Math.round(dollars * 100);
export const retailTarget = tier => Math.round(cents(tier) * 1.3);
export const eligible = p => p.condition === 'Ready' && p.price !== null && p.match !== 'review';
export const fastSeller = p => eligible(p) && p.match === 'exact' && p.sold >= 20 && p.days <= 7;
export const recommended = p => fastSeller(p) ? Math.max(0, Math.min(p.qty, Math.ceil(p.sold / 30 * 7) - p.stock)) : 0;
export const totalQty = quantities => Object.values(quantities).reduce((a,b) => a + b, 0);
export const value = quantities => Object.entries(quantities).reduce((sum,[id,qty]) => sum + (byId(id)?.price ? cents(byId(id).price) * qty : 0), 0);
export function initialState() {
  return {version:1, pulls:Object.fromEntries(PRODUCTS.map(p => [p.id,recommended(p)])), transfer:null, pallets:[], draft:{tier:400,items:{}}};
}
export function available(state, id) {
  return byId(id).qty - (state.pulls[id] || 0) - state.pallets.reduce((sum,p) => sum + (p.items[id] || 0), 0);
}
export function setPull(state, id, qty) {
  const p=byId(id);
  if (state.transfer) throw new Error('This demo pull is already sent. Reset the demo to start again.');
  if (!p || !eligible(p) || p.match !== 'exact') throw new Error('Only ready products with an exact store SKU match can be pulled.');
  const limit=p.qty-state.pallets.reduce((sum,pallet)=>sum+(pallet.items[id]||0),0);
  if (!Number.isInteger(qty) || qty<0 || qty>limit) throw new Error(`Choose a whole quantity from 0 to ${limit}.`);
  state.pulls[id]=qty;
  // A changed reservation invalidates only conflicting draft quantities.
  if ((state.draft.items[id]||0)>available(state,id)) state.draft.items[id]=available(state,id);
}
export function setDraftQty(state,id,qty) {
  const p=byId(id);
  if (!p || !eligible(p)) throw new Error('Review items cannot be added to pallets.');
  if (!Number.isInteger(qty) || qty<0 || qty>available(state,id)) throw new Error(`Only ${available(state,id)} units are available.`);
  if (qty) state.draft.items[id]=qty; else delete state.draft.items[id];
}
// Bounded subset-sum: closest achievable retail total at or above the target.
// Values use a GCD unit to keep cent-precise arithmetic and a compact search.
export function autoFill(state) {
  const items=PRODUCTS.filter(eligible).flatMap(p=>Array.from({length:available(state,p.id)},()=>({id:p.id,price:cents(p.price)})));
  const target=retailTarget(state.draft.tier);
  if (!items.length) throw new Error('No unallocated inventory remains.');
  if (items.reduce((s,p)=>s+p.price,0)<target) throw new Error('Not enough retail value remains for this tier. Choose a lower tier or reduce a store pull.');
  const gcd=(a,b)=>b?gcd(b,a%b):a;
  const unit=items.reduce((g,p)=>gcd(g,p.price),items[0].price);
  const minimum=Math.ceil(target/unit), maximum=minimum+Math.max(...items.map(p=>p.price/unit));
  const reachable=new Map([[0,null]]);
  for(const item of items) {
    const price=item.price/unit;
    for(const [sum,node] of [...reachable.entries()].sort((a,b)=>b[0]-a[0])) {
      const next=sum+price;
      if(next<=maximum && !reachable.has(next)) reachable.set(next,{id:item.id,previous:node});
    }
    if(reachable.has(minimum)) break;
  }
  const best=[...reachable.keys()].filter(n=>n>=minimum).sort((a,b)=>a-b)[0];
  if(best===undefined) throw new Error('No suitable composition found.');
  const quantities={};
  for(let node=reachable.get(best);node;node=node.previous) quantities[node.id]=(quantities[node.id]||0)+1;
  state.draft.items=quantities;
  return quantities;
}
export function pack(state) {
  if(!TIERS.includes(state.draft.tier)) throw new Error('Select a valid pallet tier.');
  if(value(state.draft.items)<retailTarget(state.draft.tier)) throw new Error('Retail target not reached. Add more items before packing.');
  for(const [id,qty] of Object.entries(state.draft.items)) {
    if(!byId(id) || !eligible(byId(id)) || !Number.isInteger(qty) || qty<0 || qty>available(state,id)) throw new Error('Inventory changed. Review the composition.');
  }
  const pallet={id:`PLT-${String(state.pallets.length+1).padStart(3,'0')}`,tier:state.draft.tier,items:{...state.draft.items},packedAt:new Date().toISOString()};
  state.pallets.push(pallet);
  state.draft.items={};
  return pallet;
}
export function sendTransfer(state) {
  if(state.transfer) throw new Error('This pull has already been sent.');
  if(!totalQty(state.pulls)) throw new Error('Add at least one item to the pull list.');
  state.transfer={id:'TRF-001',items:{...state.pulls},sentAt:new Date().toISOString(),status:'Sent (simulated)'};
  return state.transfer;
}
export function validState(s) {
  try {
    if(s?.version!==1 || !s.pulls || !Array.isArray(s.pallets) || !TIERS.includes(s.draft?.tier)) return false;
    const validItems=(items,mode)=>items && typeof items==='object' && !Array.isArray(items) && Object.entries(items).every(([id,q])=>byId(id) && Number.isInteger(q) && q>=0 && q<=byId(id).qty && (!q || (eligible(byId(id)) && (mode!=='pull' || byId(id).match==='exact'))));
    if(!validItems(s.pulls,'pull') || !validItems(s.draft.items)) return false;
    if(s.transfer && (!validItems(s.transfer.items,'pull') || PRODUCTS.some(p=>(s.transfer.items[p.id]||0)!==(s.pulls[p.id]||0)))) return false;
    if(!s.pallets.every(p=>TIERS.includes(p.tier) && validItems(p.items) && value(p.items)>=retailTarget(p.tier))) return false;
    return PRODUCTS.every(p=>available(s,p.id)>=0 && (s.draft.items[p.id]||0)<=available(s,p.id));
  } catch { return false; }
}
