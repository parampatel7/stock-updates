const axios = require('axios');
async function test() {
  const from = '07-03-2026';
  const to = '14-03-2026';
  try {
    const res1 = await axios.get('https://www.nseindia.com', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const cookie = res1.headers['set-cookie'] ? res1.headers['set-cookie'].map(c => c.split(';')[0]).join('; ') : '';
    
    // Test 1: bulk corporate actions
    const res2 = await axios.get(`https://www.nseindia.com/api/corporates-corporateActions?index=equities&from_date=${from}&to_date=${to}&csv=false`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie, 'Accept': 'application/json' }
    });
    console.log("Bulk Actions:", Array.isArray(res2.data) ? res2.data.length : res2.data?.data?.length);
  } catch (e) {
    console.log("Error", e.message);
  }
}
test();
