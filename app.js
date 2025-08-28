const express = require('express');
const app = express();

// public/index.html 파일을 정적으로 서비스
app.use(express.static('public'));

// 이 부분은 삭제하거나 필요한 경우 다른 경로로 변경
// app.get('/', function(req, res){
//     res.send('<html><body><h1> It work! </h1></body></html>')
// });


app.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
});