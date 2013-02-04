	var http = require('http');
	var databaseUrl = "kivasearchdb";
	var collections = ["loans", "search_criteria", "partners"];
	var db = require("mongojs").connect(databaseUrl, collections);

	var app_id = "com.mfloanfinder.beta";

	var countries = require("./slim-2.js");

	exports.database = db;

	var allPartners = {};

	var A_DAY = 24*60*60*1000;
	var A_WEEK = A_DAY * 7;
	var A_MONTH = A_DAY * 30;

	exports.prefetchallPartners =
	function(){
		db.partners.find(function(err,partners){
			console.log("Prefetching all partners");
			for (id in partners){
				var partner = partners[id];
				allPartners[partner.id] = partner;
			}
		});
	};

	//For loans not updated for more than five minutes 
	//check the status at Kiva and delete if funded.
	exports.cleanupStaleLoans = function(){
		console.log("Running DB Cleanup job now");
		query = {last_updated:{$lt:(Date.now() - (2 * 60 * 1000))}};
		console.log(JSON.stringify(query));
		db.loans.find(query,{id:1},function(err,docs){
			if (docs.length > 0){
				console.log("Deleting:" + docs.length + " loans from DB : Possibly already funded");
				//console.log(JSON.stringify(docs));
				var ids = [];
				for (var  i =0 ; i < docs.length; i++){
					ids[i] = docs[i]["id"];
				}
				//console.log(ids.toString());
				query = {id:{$in:ids}};
				console.log("Deleting : " + JSON.stringify(query));
				db.loans.remove(query);
			}
		});
	};

	function saveLoanToDb(loan){
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
		db.loans.find({id:loan.id},function(err,doc){			
			if(doc.length == 0){
				//console.log("Saving new loan, ID:" + loan.id);
				//add borrower_count as a field, for easier querying.				
				db.loans.save(loan);
			}
			else{
				//console.log("Updating loan, ID:" + loan.id);	
				db.loans.update({id:loan.id},loan);
			}
			//Save Partner if it does not exist
			db.partners.find({id:loan.partner_id},function(err,partner){
				if (partner.length == 0){
					exports.refreshPartnerData();
				}
			});
		});
	}

	var partnerscraper = require('./scrape_partnerdata_job.js');
	function savePartnerToDb(partner){
		db.partners.findOne({id:partner.id},{id:1,additional_info:1},function(err,doc){
			if(doc == null){
				console.log("Saving new Partner, ID:" + partner.id);
				db.partners.save(partner);
				partnerscraper.scrapePartnerInfo(partner.id);
			}
			else if (doc.additional_info == null){
				console.log("Webscrapping is not yet done for partner :" + doc.id);
				partnerscraper.scrapePartnerInfo(partner.id);
			}
		});
	}


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

	}

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
	}

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
			"borrower_count":{$gte:parseInt(borrower.borrowerCount.min)},
			"amount_needed":{$lte:parseInt(borrower.amount_needed.max),$gte:parseInt(borrower.amount_needed.min)},
			"repayment_term":{$gte:parseInt(borrower.repayment_term.min),$lte:parseInt(borrower.repayment_term.max)},
			"expiration_days":{$gte:parseInt(borrower.expiration_days.min),$lte:parseInt(borrower.expiration_days.max)},
			"partner.rating":{$gte:partner.partner_rating.min},
			"partner.delinquency_rate":{$gte:parseInt(partner.partner_delinquency_rate.min),$lte:parseInt(partner.partner_delinquency_rate.max)},
			"partner.default_rate":{$gte:parseInt(partner.partner_default_rate.min),$lte:parseInt(partner.partner_default_rate.max)},
			"partner.additional_info.portfolio_yield":{$gte:parseInt(partner.partner_portfolio_yield.min),$lte:parseInt(partner.partner_portfolio_yield.max)},
			"partner.additional_info.profitability":{$gte:parseInt(partner.partner_profit_percentage.min),$lte:parseInt(partner.partner_profit_percentage.max)}
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
		db.loans.find(query, resultTemplate,callback);
	}

