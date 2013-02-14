var kiva = require('./kivasearchdb.js');
var scraper = require('./scrape_partnerdata_job.js');

kiva.database.partners.find({},{id:1},function(err,docs){
	if (err){
		console.error(err);
		return;
	}
	if (docs.length > 0){
		for (doc in docs){
			scraper.scrapePartnerInfo(docs[doc].id,function(data){
				kiva.scrapeCallback(data);
			});	
		}
	}
});

