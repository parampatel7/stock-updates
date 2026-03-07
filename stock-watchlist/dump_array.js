const axios = require('axios');
async function test() {
  const res1 = await axios.get('https://www.nseindia.com', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }});
  const sc = res1.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
  
  const from = '07-03-2026';
  const to = '06-04-2026';
  const url = `https://www.nseindia.com/api/corporates-corporateActions?index=equities&from_date=${from}&to_date=${to}&csv=false`;
  const res2 = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Cookie': sc }});
  
  console.log("Array length:", res2.data.length);
  console.log("First element:", res2.data[0]);
}
test();
