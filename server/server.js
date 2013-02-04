var express = require('express');
var http = require('http');
var app = express();
var kiva = require('./kivasearchdb.js');

var KIVA_RECENT_LOAN_UPDATE_INTERVAL = 60000;
var KIVA_PARTNERS_UPDATE_INTERVAL = 60000 * 60;
var KIVA_LOAN_CLEANUP_INTERVAL = 37000;

app.use(express.static(__dirname + '/../client'));

kiva.refreshPartnerData();
kiva.refreshLoanList();
kiva.prefetchallPartners();

setTimeout(function(){
	console.log("Initialing the DB Cleanup BG Job");
	setInterval(kiva.cleanupStaleLoans,KIVA_LOAN_CLEANUP_INTERVAL);	
	console.log("Stale loans will be cleaned from DB every " + KIVA_LOAN_CLEANUP_INTERVAL / 1000 + " Seconds");
},120 * 1000);

setInterval(kiva.refreshLoanList,KIVA_RECENT_LOAN_UPDATE_INTERVAL);
console.log("Kiva recent loans will be updated every " + KIVA_RECENT_LOAN_UPDATE_INTERVAL / 1000 + " Seconds");
setInterval(kiva.refreshPartnerData,KIVA_PARTNERS_UPDATE_INTERVAL);
console.log("Kiva partners list will be updated every " + KIVA_PARTNERS_UPDATE_INTERVAL / 1000 + " Seconds");

app.use(express.bodyParser());
app.get('/', function(req, resp) {
	resp.redirect('/index.html');
});

app.get('/test', function(req, resp) {
	resp.redirect('/loan-list-template.html');
});


app.post('/search', function(req, res) {
	var criterion = req.body;
	kiva.findMatchingLoans(criterion,function(err,docs){
		res.send(docs);	
		console.log("Matching Loans:" + docs.length);
	});
	
});

app.listen(3000);
console.log("Listening on port 3000");

