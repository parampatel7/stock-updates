const axios = require('axios');
async function test() {
  const res = await axios.get('https://www.nseindia.com', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const cookie = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
  
  const d1 = new Date();
  const d2 = new Date(Date.now() + 7*24*3600*1000);
  const from = `${d1.getDate().toString().padStart(2,'0')}-${(d1.getMonth()+1).toString().padStart(2,'0')}-${d1.getFullYear()}`;
  const to = `${d2.getDate().toString().padStart(2,'0')}-${(d2.getMonth()+1).toString().padStart(2,'0')}-${d2.getFullYear()}`;
  
  console.log("Fetching for dates:", from, to);
  const url = `https://www.nseindia.com/api/corporates-corporateActions?index=equities&from_date=${from}&to_date=${to}&csv=false`;
  
  try {
    const {data} = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', Cookie: cookie }});
    console.log("Success! Items:", data.length || (data.data && data.data.length));
    if (data.data) console.log(data.data[0]);
  } catch(e) { console.error("Error:", e.message); }
}
test();
