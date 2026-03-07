const axios = require('axios');
async function test() {
  const from = '01-03-2026';
  const to = '15-03-2026';
  try {
    const res1 = await axios.get('https://www.nseindia.com', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const cookie = res1.headers['set-cookie'] ? res1.headers['set-cookie'].map(c => c.split(';')[0]).join('; ') : '';
    
    // The previous url used csv=false. Let's see without it.
    console.log("Without csv flag");
    const res2 = await axios.get(`https://www.nseindia.com/api/corporates-corporateActions?index=equities&symbol=SBICARDS&from_date=${from}&to_date=${to}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie, 'Accept': 'application/json' }
    });
    console.log(typeof res2.data, res2.data.substring ? res2.data.substring(0, 100) : res2.data);
    
    // How about the calendar API instead?
    console.log("Calendar API instead");
    const res3 = await axios.get(`https://www.nseindia.com/api/event-calendar`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie, 'Accept': 'application/json' }
    });
    console.log(res3.data);
  } catch (e) {
    console.log("Error", e.message, e.response ? e.response.status : '');
  }
}
test();
