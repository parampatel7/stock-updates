const axios = require('axios');
async function test() {
  const from = '01-03-2026';
  const to = '15-03-2026';
  try {
    const res1 = await axios.get('https://www.nseindia.com', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const cookie = res1.headers['set-cookie'] ? res1.headers['set-cookie'].map(c => c.split(';')[0]).join('; ') : '';
    
    const url = `https://www.nseindia.com/api/corporates-corporateActions?index=equities&symbol=SBICARDS&from_date=${from}&to_date=${to}&csv=false`;
    console.log("URL:", url);
    const res2 = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie, 'Accept': 'application/json' }
    });
    console.log("Data:", res2.data);
  } catch (e) {
    console.log("Error", e.message);
  }
}
test();
