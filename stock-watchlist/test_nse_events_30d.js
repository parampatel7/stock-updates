const axios = require('axios');
async function test() {
  const from = '07-03-2026';
  const to = '06-04-2026';
  try {
    const res1 = await axios.get('https://www.nseindia.com', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const cookie = res1.headers['set-cookie'] ? res1.headers['set-cookie'].map(c => c.split(';')[0]).join('; ') : '';
    
    const res2 = await axios.get(`https://www.nseindia.com/api/corporates-corporateActions?index=equities&from_date=${from}&to_date=${to}&csv=false`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie, 'Accept': 'application/json' }
    });
    console.log("Bulk Actions status:", res2.status);
    console.log("Bulk Actions data:", typeof res2.data === 'string' ? "String (" + res2.data.slice(0, 50) + "...)" : "Object");
    
    // Board meetings
    const res3 = await axios.get(`https://www.nseindia.com/api/corporate-board-meetings?index=equities&from_date=${from}&to_date=${to}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie, 'Accept': 'application/json' }
    });
    console.log("Board Meetings status:", res3.status);
    console.log("Board Meetings data:", typeof res3.data === 'string' ? "String (" + res3.data.slice(0, 50) + "...)" : "Object");
  } catch (e) {
    console.log("Error", e.response ? e.response.status : e.message);
    if (e.response && e.response.data) console.log(e.response.data.slice && e.response.data.slice(0, 100));
  }
}
test();
