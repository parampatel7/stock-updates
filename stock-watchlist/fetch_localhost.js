const axios = require('axios');
async function test() {
  const url = 'http://localhost:3000/api/upcoming-events?symbols=SBICARD';
  const start = Date.now();
  const res = await axios.get(url);
  console.log(res.data, 'Time ms:', Date.now() - start);
}
test();
