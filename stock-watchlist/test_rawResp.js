const axios = require('axios');
const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': '*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
};
async function test() {
  const res1 = await axios.get('https://www.nseindia.com', { headers, timeout: 12000 });
  const raw = res1.headers['set-cookie'] || [];
  const nseSessionCookies = raw.map(c => c.split(';')[0]).join('; ');
  
  const today = new Date();
  const d = String(today.getDate()).padStart(2, '0');
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const y = today.getFullYear();
  const from = `${d}-${m}-${y}`;

  const fut30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const d2 = String(fut30.getDate()).padStart(2, '0');
  const m2 = String(fut30.getMonth() + 1).padStart(2, '0');
  const y2 = fut30.getFullYear();
  const to = `${d2}-${m2}-${y2}`;

  const urlAct = `https://www.nseindia.com/api/corporates-corporateActions?index=equities&from_date=${from}&to_date=${to}&csv=false`;
  
  const res = await axios.get(urlAct, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.nseindia.com/',
      'Cookie': nseSessionCookies,
    },
    timeout: 15000,
    responseType: 'text'
  });
  
  const rawResp = res.data;
  console.log("typeof rawResp:", typeof rawResp);
  if (typeof rawResp === 'string') {
    console.log("length:", rawResp.length);
    console.log("snippet:", rawResp.slice(0, 100));
  } else {
    console.log("Is array:", Array.isArray(rawResp));
    console.log("keys:", Object.keys(rawResp));
  }
}
test();
