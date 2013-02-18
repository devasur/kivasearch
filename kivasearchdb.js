	var partnerscraper = require('./scrape_partnerdata_job.js');

	var http = require('http');
	
	if(process.env.VCAP_SERVICES){
	    var env = JSON.parse(process.env.VCAP_SERVICES);
	    var mongo = env['mongodb-1.8'][0]['credentials'];
	}
	else{
	    var mongo = {
	        "hostname":"localhost",
	        "port":27017,
	        "username":"",
	        "password":"",
	        "name":"",
	        "db":"kivasearchdb"
	    }
	}

	var generate_mongo_url = function(obj){
	    obj.hostname = (obj.hostname || 'localhost');
	    obj.port = (obj.port || 27017);
	    obj.db = (obj.db || 'test');
	    if(obj.username && obj.password){
	        return "mongodb://" + obj.username + ":" + obj.password + "@" + obj.hostname + ":" + obj.port + "/" + obj.db;
	    }
	    else{
	        return "mongodb://" + obj.hostname + ":" + obj.port + "/" + obj.db;
	    }
	}
	
	var databaseUrl = generate_mongo_url(mongo);

	var collections = ["loans", "search_criteria", "partners","chkoutloans"];
	var db = require("mongojs").connect(databaseUrl, collections);

	var app_id = "cm.af.aws.kivasearch";

	var countries = require("./slim-2.js");

	exports.database = db;

	var allPartners = {};

	var A_MINUTE = 60 * 1000;
	var AN_HOUR = A_MINUTE * 60;	
	var A_DAY = 24 * AN_HOUR;
	var A_WEEK = A_DAY * 7;
	var A_MONTH = A_DAY * 30;

	exports.prefetchallPartners =
	function(){
		db.partners.find(function(err,partners){
			console.log("Prefetching all partners");
			for (id in partners){
				var partner = partners[id];
				partner.rating = parseFloat(partner.rating); 
				allPartners[partner.id] = partner;
			}
		});
	};

	//For loans not updated for more than five minutes 
	//check the status at Kiva and delete if funded.
	exports.cleanupStaleLoans = function(){
		console.log("Running DB Cleanup job now");
		query = {last_updated:{$lt:(Date.now() - (2 * A_MINUTE))}};
		console.log(JSON.stringify(query));
		db.loans.remove(query);
		db.loans.count({},function(result){
			console.log("Loan Count:" + JSON.stringify(result));
		})
	};

	function saveLoanToDb(loan){
		if (allPartners[loan.partner_id] == null){
			console.log("Skipping loan update for id:" + loan.id + ", Missing partner data");
			return;
		}
		loan['borrower_count'] = loan.borrowers.length;
		loan['amount_needed'] = (loan.loan_amount - (loan.funded_amount + loan.basket_amount));
		loan['partner'] = allPartners[loan.partner_id];
		loan['last_updated'] = Date.now();		
		loan['amount_needed_per_borrower'] = parseInt( 
			parseInt(loan.loan_amount) / 
			parseInt(loan['borrower_count']));
		loan['percentage_funded'] = parseInt(((loan.funded_amount + loan.basket_amount) / loan.loan_amount)*100);
		loan['country_name'] = countries.countries_map[loan.location.country_code.toUpperCase()];
		loan.location.country_code = loan.location.country_code.toLowerCase(); 
		loan['loan_description_excerpt'] = "...";
		var payments = loan.terms.scheduled_payments;
		var last_payment_date = payments[payments.length-1].due_date;
		var months = Math.round((new Date(last_payment_date) - Date.now()) / A_MONTH);
		loan['repayment_term'] = months;
		loan['expiration_days'] = Math.round((new Date(loan.planned_expiration_date) - Date.now()) / A_DAY);
		if (isNaN(loan.partner.rating)){
			console.log("Partner :" + loan.partner.name + " is with status :" + loan.partner.status + ",Marking Rating as 0");			
			loan.partner.rating = 0;
		}
		else{
			loan.partner.rating = parseFloat(loan.partner.rating);	
		}
		db.loans.findOne({id:loan.id},{id:1},function(err,doc){
			if(doc != null){
				db.loans.remove({id:doc.id});
			}
			db.loans.save(loan);
		});
	}

	exports.scrapeCallback = 
	function (additionalPartnerInfo){
		if (!additionalPartnerInfo){
			console.log("Error while fetching additional partner info");
		}
		else{
	  
    		db.partners.update({id:additionalPartnerInfo.partner_id},{
    			$set:{"additional_info" : additionalPartnerInfo}
    		});
	  	}
	  	console.log("Additional data added for partner :" + additionalPartnerInfo.partner_id);
	}

	function savePartnerToDb(partner){
		db.partners.findOne({id:partner.id},{id:1,additional_info:1},function(err,doc){
			if(doc == null){
				console.log("Saving new Partner, ID:" + partner.id);
				db.partners.save(partner);
				partnerscraper.scrapePartnerInfo(partner.id, function(data){
					scrapeCallback(data);
				});
			}
			else if (doc.additional_info == null){
				partnerscraper.scrapePartnerInfo(doc.id,function(data){
					scrapeCallback(data);
				});
			}
		});
	};


	exports.refreshPartnerData =
	function (){
		console.log("Starting partner data refresh");
		var options = {
		  hostname: 'api.kivaws.org',
		  port: 80,
		  path: '/v1/partners.json&app_id=' + app_id,
		  method: 'GET'
		};

		var data = '';

		var req = http.request(options, function(res) {
		  res.setEncoding('utf8');
		  res.on('data', function (chunk) {
		    data+=chunk;
		  });
		res.on('end',function(){
			var partners = JSON.parse(data).partners;
			for (id in partners){
				var partner = partners[id];
				savePartnerToDb(partner);
			}
			console.log("Partner data saved to database");
		});
		});

		req.on('error', function(e) {
		  console.log('problem with request: ' + e.message);
		});
		req.end();

	};

	function refreshLoanListByPage(page){
		var options = {
		  hostname: 'api.kivaws.org',
		  port: 80,
		  path: '/v1/loans/newest.json&page='+page + '&app_id=' + app_id,
		  method: 'GET'
		};

		var data = '';
		var i = 0;

		var req = http.request(options, function(res) {
		  res.setEncoding('utf8');
		  res.on('data', function (chunk) {
		    data+=chunk;
		  });
		res.on('end',function(){
			var loans = JSON.parse(data).loans;
			var ids=[];
			var i = 0;
			//console.log("There are " + loans.length + " Loans in this page");
			for (aLoan in loans){
				ids[i] = loans[aLoan].id;
				if (allPartners[loans[aLoan].partner_id] == null){
					console.log("Skipping loan update for id:" + loans[aLoan].id + ", Missing partner data");
					break;
				}

				i = i + 1;
				if (i >= 10){
					//console.log("Getting Loan Details Now");
					getLoanDetails(ids.toString());
					i = 0;
					ids=[];
				}
			}
			getLoanDetails(ids);
		});
		});

		req.on('error', function(e) {
		  console.log('problem with request: ' + e.message);
		});
		req.end();
	}

	function getLoanDetails(ids){

		//console.log("IDs:" + ids);

		var options = {
		  hostname: 'api.kivaws.org',
		  port: 80,
		  path: '/v1/loans/'+ ids +'.json'+ '&app_id=' + app_id,
		  method: 'GET'
		};

		var data = '';
		var req = http.request(options, function(res) {
		  res.setEncoding('utf8');
		  res.on('data', function (chunk) {
		    data+=chunk;
		  });
		res.on('end',function(){
			var loans = JSON.parse(data).loans;
			for (aLoan in loans){
				var loan = loans[aLoan];
				saveLoanToDb(loan);
			}
		});
		});

		req.on('error', function(e) {
		  console.log('problem with request: ' + e.message);
		});
		req.end();
	}

	exports.refreshLoanList =
	function (){
		var options = {
		  hostname: 'api.kivaws.org',
		  port: 80,
		  path: '/v1/loans/newest.json&app_id=' + app_id,
		  method: 'GET'
		};

		var data = '';
		var i = 0;

		var req = http.request(options, function(res) {
			  res.setEncoding('utf8');
			  res.on('data', function (chunk) {
			    data+=chunk;
			  });
			res.on('end',function(){
			var paging = JSON.parse(data).paging;
			var noOfPages = paging.pages;
			for (i = 1 ; i < noOfPages+1; i++){
				refreshLoanListByPage(i);
			}
			});
		});
		req.on('error', function(e) {
		  console.log('problem with request: ' + e.message);
		});
		req.end();
	};

	//({borrower_count:{$lt:2}})
	/*
	{ borrower: 
	   { borrowerCount: { min: 0, max: 2 },
	     amount_needed: { min: 0, max: 700 },
	     repayment_term: { min: 0, max: 5 },
	     expiration_days: { min: 0, max: 30 },
	     currency_loss_protection: false },
	  partner: 
	   { partner_rating: { min: '3', max: 5 },
	     partner_delinquency_rate: { min: 0, max: 5 },
	     partner_default_rate: { min: 0, max: 4 },
	     partner_portfolio_yield: { min: 0, max: 25 },
	     partner_profit_percentage: { min: 0, max: 25 },
	     exclude_pilot: false } }
	*/
	exports.findMatchingLoans = function(criterion,callback){
		var borrower = criterion.borrower;
		var partner = criterion.partner;
		var query = {			
			"status":"fundraising",
			"borrower_count":{$gte:parseInt(borrower.borrowerCount.min),$lte:parseInt(borrower.borrowerCount.max)},
			"amount_needed":{$gte:parseInt(borrower.amount_needed.max),$gte:parseInt(borrower.amount_needed.min)},
			"repayment_term":{$gte:parseInt(borrower.repayment_term.min),$lte:parseInt(borrower.repayment_term.max)},
			"expiration_days":{$gte:parseInt(borrower.expiration_days.min),$lte:parseInt(borrower.expiration_days.max)},
			"partner.rating":{$gte:partner.partner_rating.min,$lte:partner.partner_rating.max},
			"partner.delinquency_rate":{$gte:parseFloat(partner.partner_delinquency_rate.min),$lte:parseFloat(partner.partner_delinquency_rate.max)},
			"partner.default_rate":{$gte:parseFloat(partner.partner_default_rate.min),$lte:parseFloat(partner.partner_default_rate.max)},
			"partner.additional_info.portfolio_yield":{$gte:parseFloat(partner.partner_portfolio_yield.min),$lte:parseFloat(partner.partner_portfolio_yield.max)},
			"partner.additional_info.profitability":{$gte:parseFloat(partner.partner_profit_percentage.min),$lte:parseFloat(partner.partner_profit_percentage.max)}
		};

		if (partner.exclude_pilot){
			query["partner.status"] = {$ne:"pilot"};
		}

		if (borrower.currency_loss_protection){
			query["borrower.terms.loss_liability.currency_exchange"] = "partner"; 	
		}

		var resultTemplate = 
		{
			"id":1,
			"name":1,
			"borrower_count":1,
			"location.country_code":1,
			"country_name":1,
			"sector":1,
			"use":1,
			"description":1,
			"loan_amount":1,
			"funded_amount":1,
			"amount_needed_per_borrower":1,
			"percentage_funded":1,
			"activity":1,
			"image":1,
			"partner.image":1,
			"partner.name":1
		};
		console.log(JSON.stringify(query));
		db.loans.find(query, resultTemplate).sort({"percentage_funded":-1},callback);
	};

	exports.saveCheckOutActivity = function(loans){
		for(key in loans){
			db.chkoutloans.save(loans[key]);	
		}
	}

	var indexFields =
		{
		"id":1,"partner_id":1,
		"status":1,"borrower_count":1,"amount_needed":1,"repayment_term":1,"expiration_days":1,
		"partner.rating":1,"partner.delinquency_rate":1,"partner.default_rate":1,
		"partner.additional_info.portfolio_yield":1,"partner.additional_info.profitability":1};
	exports.createIndexes = function(){
		db.loans.indexInformation(function(err,current_indexes){
			for(aKey in current_indexes){
				//skipping already created indexes.
				var field = current_indexes[aKey][0][0];
				delete(indexFields[field]);
			}
		});
		for(key in indexFields){
			//Creating index for each field specified
			createIndex(key);	
		}
		db.loans.indexInformation(function(err,data){
			console.log("DB has the following indexes");
			console.log(data);
		});
	}

	function createIndex(field){
		db.loans.ensureIndex([[field,1]],function(err,data){
			if(err){console.log(err);}
			else{
				//console.log(data);
			}
		});

	}

	exports.countLoans = function(callback){
		db.loans.find({},{id:1},function(err,data){
			if(err){
				callback(err,{count:0});
			}
			else{
				callback(err,{count:data.length});
			}
		});
	}

	exports.countChkoutLoans = function(callback){
		db.chkoutloans.find({},{id:1},function(err,data){
			if(err){
				callback(err,{count:0});
			}
			else{
				callback(err,{count:data.length});
			}
		});
	}
