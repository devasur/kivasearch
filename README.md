[KivaSearch](http://kivasearch.aws.af.cm/)
============

Application is [live](http://kivasearch.aws.af.cm/) at AppFog.


Node, MongoDB based Search tool for Kiva [Early Beta].

Currently Application is feature complete 

- Refreshed Loans and Partners from Kiva<>
- User can search and select loans into a basket.
- Users can complete the lending by transfering loans to Kiva.

[TODO]
- User preference saving
- Scheduled searches on behalf of users and availability notifications.
- Mobile app.


Pre Requisites
============
You need Node, npm and MongoDB installed and configured.  Currently, the MongoDB ports and security is set as default.  
I will update this section when I add node-config to externalize connection parameters.

Instalation
===========
1. cd server<br>
2. npm install<br>
3. node server.js<br>

It can take upto 2 minutes for the initial database priming.  Once that is done head over to http://localhost:3000/
and lend away.

Stay tuned for updates.

ciao!



