var express = require('express');
var http = require('http');
var app = express();
var kiva = require('./kivasearchdb.js');
var schema = require('./dbschema.js');
var countries = require("./slim-2.js");

var KIVA_RECENT_LOAN_UPDATE_INTERVAL = 60000;
var KIVA_PARTNERS_UPDATE_INTERVAL = 60000 * 60;
var KIVA_LOAN_CLEANUP_INTERVAL = 37000;

//var nodeio = require('node.io');

function scrapePartnerInfo(id){
var select = require('soupselect').select,
    htmlparser = require("htmlparser"),
    http = require('http'),
    sys = require('sys');

var http = require('http');
var host = 'www.kiva.org';
//var client = http.createClient(80, host);

var options = {
  hostname: 'www.kiva.org',
  port: 80,
  path: '/partners/' + id,
  method: 'GET'
};
var request = http.request(options);

request.setTimeout(30000, function(){
	console.log("Timeout Error");
});

request.on('response', function (response) {
    response.setEncoding('utf8');

    var body = "";
    response.on('data', function (chunk) {
        body = body + chunk;
    });

    response.on('end', function() {
    	console.log(this.req.path);
        // now we have the whole body, parse it and select the nodes we want...
        var handler = new htmlparser.DefaultHandler(function(err, dom) {
            if (err) {
                sys.debug("Error: " + err);
            } else {

                // soupselect happening here...
                var data = select(dom, 'aside.partnerSummary div.info dl dt a');
                var partnerInfoTitles = [];
                data.forEach(function(a) {
                    partnerInfoTitles.push(a.children[0].data);
                });
                data = select(dom, 'aside.partnerSummary div.info dl dd');
                var partnerInfoData = [];
                data.forEach(function(a) {
                    partnerInfoData.push(a.children[0].data);
                });
				var partnerdata = {};
		        for (var i = 0 ; i < partnerInfoTitles.length; i++){
		        	partnerdata[partnerInfoTitles[i].slice(0,-1)] = partnerInfoData[i].replace(/[ \n\t\r]+/g,"");
		        }
		        var fp = partnerdata["Field Partner"];
		        var partnerId = fp.split("\"")[1].split("/")[4];
		        partnerdata["partnerId"] = partnerId;
		        delete(partnerdata["Field Partner"]);
		        delete(partnerdata["Field Partner Due Diligence Type"]);
		        delete(partnerdata["Field Partner Risk Rating"]);
		        /*
		        { 'Time on Kiva': '43months',
				  'Kiva Entrepreneurs': '354',
				  'Total Loans': '$1,804,750',
				  'Interest & Fees are Charge': 'Yes',
				  'Portfolio Yield': '14.52%',
				  Profitabilit: '-27.76%',
				  'Average Loan Siz': '9.48%',
				  'Delinquency Rate': '2.82%',
				  'Loans at Risk Rate': '14.07%',
				  'Default Rate': '6.97%',
				  'Currency Exchange Loss Rate': '0.00%',
				   partnerId: '131' }
		        */
		        var timeOnKiva = partnerdata["Time on Kiva"];
		        var totalLoanAmount = partnerdata["Total Loans"];
		        function chopPercentage(value){
		        	//console.log("Percentage :" + value);
		        	if (value == "N/A" || value == undefined) return 0;		        	
		        	var toReturn = parseFloat(value.substring(0,value.indexOf("%")));
		        	if (toReturn == NaN) return 0;
		        	return toReturn;
		        }
		        var additionalPartnerInfo = {
		        	"partner_id" : parseInt(partnerdata["partnerId"]),
		        	"on_kiva_since" : timeOnKiva.substring(0,timeOnKiva.indexOf('months')),
		        	"entrepreneur_count":partnerdata["Kiva Entrepreneurs"],
		        	"total_loan_amount": (totalLoanAmount.substr(1)).replace(/,/g,''),
		        	"portfolio_yield": chopPercentage(partnerdata["Portfolio Yield"]),
		        	"profitability" : chopPercentage(partnerdata["Profitabilit"]),
		        	"loansize_to_country_percapita" : chopPercentage(partnerdata["Average Loan Siz"]),
		        	"delinquency_rate" : chopPercentage(partnerdata["Delinquency Rate"]),
		        	"loans_at_risk_rate" : chopPercentage(partnerdata["Loans at Risk Rate"]),
		        	"default_rate" : chopPercentage(partnerdata["Default Rate"]),
		        	"curr_exchange_loss_rate" : chopPercentage(partnerdata["Currency Exchange Loss Rate"])
		        };
				kiva.database.partners.findOne({id:additionalPartnerInfo.partner_id},function(err,partner){
					if (err){
						console.error(err);
						return;
					}
					if (partner){
						console.log("ID:" + partner.id + "\n" + JSON.stringify(additionalPartnerInfo) );
						kiva.database.partners.update({id:partner.id},{
							$set:{"additional_info" : additionalPartnerInfo}
						});
					}
				});

		    }
        }
        );

        var parser = new htmlparser.Parser(handler);
        parser.parseComplete(body);
    });

	response.on('error', function(err){
		console.log(err);
	});
});
request.end();
}



kiva.database.partners.find({},{id:1},function(err,docs){
	if (err){
		console.error(err);
		return;
	}
	if (docs.length > 0){
		for (doc in docs){
			scrapePartnerInfo(docs[doc].id);	
		}
		
	}
});



//app.listen(3000);
//console.log("Listening on port 3000");

