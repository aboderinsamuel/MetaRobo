// Where parts can be bought. Links go to each supplier's own search for the part, never to a
// guessed product URL, so they always work and never point at the wrong item.
export const SUPPLIERS = {
  sparkfun: { name: "SparkFun", region: "US", search: (q: string) => `https://www.sparkfun.com/search/results?term=${encodeURIComponent(q)}` },
  adafruit: { name: "Adafruit", region: "US", search: (q: string) => `https://www.adafruit.com/search?q=${encodeURIComponent(q)}` },
  robotshop: { name: "RobotShop", region: "US/CA/EU", search: (q: string) => `https://www.robotshop.com/search?q=${encodeURIComponent(q)}` },
  pololu: { name: "Pololu", region: "US", search: (q: string) => `https://www.pololu.com/search?query=${encodeURIComponent(q)}` },
  dfrobot: { name: "DFRobot", region: "Global", search: (q: string) => `https://www.dfrobot.com/search-${encodeURIComponent(q)}.html` },
  digikey: { name: "DigiKey", region: "Global", search: (q: string) => `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(q)}` },
  mouser: { name: "Mouser", region: "Global", search: (q: string) => `https://www.mouser.com/c/?q=${encodeURIComponent(q)}` },
  lcsc: { name: "LCSC", region: "CN/Global", search: (q: string) => `https://www.lcsc.com/search?q=${encodeURIComponent(q)}` },
  pcbway: { name: "PCBWay", region: "CN/Global", search: (q: string) => `https://www.pcbway.com/project/shareproject/?keyword=${encodeURIComponent(q)}` },
  hiwonder: { name: "Hiwonder", region: "CN/Global", search: (q: string) => `https://www.hiwonder.com/search?q=${encodeURIComponent(q)}` },
  seeed: { name: "Seeed Studio", region: "CN/Global", search: (q: string) => `https://www.seeedstudio.com/catalogsearch/result/?q=${encodeURIComponent(q)}` },
  waveshare: { name: "Waveshare", region: "CN/Global", search: (q: string) => `https://www.waveshare.com/catalogsearch/result/?q=${encodeURIComponent(q)}` },
  raspberrypi: { name: "Raspberry Pi resellers", region: "Global", search: (q: string) => `https://www.raspberrypi.com/products/?q=${encodeURIComponent(q)}` },
  arduino: { name: "Arduino Store", region: "Global", search: (q: string) => `https://store.arduino.cc/search?q=${encodeURIComponent(q)}` },
  servocity: { name: "ServoCity", region: "US", search: (q: string) => `https://www.servocity.com/search.php?search_query=${encodeURIComponent(q)}` },
  openbuilds: { name: "OpenBuilds Part Store", region: "US", search: (q: string) => `https://openbuildspartstore.com/search.php?search_query=${encodeURIComponent(q)}` },
  aliexpress: { name: "AliExpress (Shenzhen sellers)", region: "CN/Global", search: (q: string) => `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(q)}` },
  amazon: { name: "Amazon", region: "Global", search: (q: string) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}` },
} as const;

export type SupplierKey = keyof typeof SUPPLIERS;

/** Fabrication services that make custom parts from a drawing (laser cutting, 3D printing, CNC). */
export const FAB_SERVICES = ["PCBWay (CNC, 3D printing, laser cutting)", "JLCPCB 3D printing", "SendCutSend (laser/CNC, US)", "Ponoko (laser cutting)", "Your school makerspace"];

export function supplierLinks(keys: readonly SupplierKey[], query: string): { name: string; url: string }[] {
  return keys.map((k) => ({ name: SUPPLIERS[k].name, url: SUPPLIERS[k].search(query) }));
}
