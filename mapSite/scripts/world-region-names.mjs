// Repair only reversible UTF-8 decoded as Latin-1/Windows-1252. Legitimate
// Icelandic, Romanian, and other Unicode names must remain untouched.
const suspicious = /(?:Ã[\u0080-\u00ff]|Â[\u0080-\u00ff]|â[€žœ€™]|ðŸ)/;
const windows1252 = new Map([..."€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"].map((character, index) =>
  [character, [128,130,131,132,133,134,135,136,137,138,139,140,142,145,146,147,148,149,150,151,152,153,154,155,156,158,159][index]]));
export function repairWorldRegionName(value) {
  let result = String(value || "");
  for (let attempt = 0; attempt < 3 && suspicious.test(result); attempt += 1) {
    const bytes = [];
    for (const character of result) {
      const code = character.codePointAt(0);
      if (code <= 255) bytes.push(code);
      else if (windows1252.has(character)) bytes.push(windows1252.get(character));
      else return result;
    }
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
      if (!decoded || decoded === result || decoded.includes("\ufffd")) break;
      result = decoded;
    } catch { break; }
  }
  return result;
}
