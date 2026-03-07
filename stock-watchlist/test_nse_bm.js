const axios = require('axios');
async function test() {
  const from = '07-03-2026';
  const to = '14-03-2026';
  try {
    const res1 = await axios.get('https://www.nseindia.com', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const cookie = res1.headers['set-cookie'] ? res1.headers['set-cookie'].map(c => c.split(';')[0]).join('; ') : '';
    
    // Test 2: bulk board meetings
    const res2 = await axios.get(`https://www.nseindia.com/api/corporate-board-meetings?index=equities&from_date=${from}&to_date=${to}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie, 'Accept': 'application/json' }
    });
    console.log("BM type:", typeof res2.data, Array.isArray(res2.data.data));
    if (typeof res2.data === 'string') {
      console.log("First line:", res2.data.split('\n')[0]);
    }
  } catch (e) {
    console.log("Error", e.message);
  }
}
test();
