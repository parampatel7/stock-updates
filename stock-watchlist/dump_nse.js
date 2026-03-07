const axios = require('axios');
async function test() {
  const res1 = await axios.get('https://www.nseindia.com', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }});
  const sc = res1.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
  
  const from = '07-03-2026';
  const to = '06-04-2026';
  const url = `https://www.nseindia.com/api/corporates-corporateActions?index=equities&from_date=${from}&to_date=${to}&csv=false`;
  const res2 = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Cookie': sc }, responseType: 'json' });
  
  console.log("Type:", typeof res2.data);
  console.log("Keys:", Object.keys(res2.data));
  console.log("Type of .data:", typeof res2.data.data);
  if (typeof res2.data.data === 'string') {
    console.log("Snippet:", res2.data.data.slice(0, 100));
  } else {
    console.log("Snippet:", JSON.stringify(res2.data.data).slice(0, 100));
  }
}
test();
