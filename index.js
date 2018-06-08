// Load dependencies
var express = require('express');
var exphbs  = require('express-handlebars');
var bodyParser = require('body-parser');
var mongo = require('mongo-mock')
var MongoClient = mongo.MongoClient;

// Load configuration from .env file
require('dotenv').config();

// This is the MongoDB URL. It does not actually exist
// but our mock requires a URL that looks "real".
var dbUrl = "mongodb://localhost:27017/myproject";

// Load and initialize MesageBird SDK
var messagebird = require('messagebird')(process.env.MESSAGEBIRD_API_KEY);

// Set up and configure the Express framework
var app = express();
app.engine('handlebars', exphbs());
app.set('view engine', 'handlebars');
app.use(bodyParser.urlencoded({ extended : true }));

// Handle incoming webhooks
app.post('/webhook', function(req, res) {
    // Read input sent from MessageBird
    var number = req.body.originator;
    var text = req.body.payload;

    MongoClient.connect(dbUrl, {}, function(err, db) {
        // Find ticket for number in our database
        var tickets = db.collection('tickets');
        tickets.findOne({ number : number }, function(err, doc) {
            if (doc == null) {
                // Creating a new ticket
                tickets.insertOne({
                    number : number,
                    open : true,
                    messages : [
                        {
                            direction : 'in',
                            content : text
                        }
                    ]
                }, function(err, result) {
                    console.log("created ticket", err, result);

                    // After creating a new ticket, send a confirmation
                    var idShort = result.insertedId.str.substring(18, 24);
                    messagebird.messages.create({
                        originator : process.env.MESSAGEBIRD_ORIGINATOR,
                        recipients : [ number ],
                        body : "Thanks for contacting customer support! Your ticket ID is " + idShort + "."
                    }, function(err, response) {
                        console.log(err, response);
                    });
                });
            } else {
                // Add an inbound message to the existing ticket
                doc.messages.push({
                    direction : 'in',
                    content : text
                });
                tickets.updateOne({
                    number : number
                }, {
                    $set: {
                        open : true,
                        messages : doc.messages
                    }
                }, function(err, result) {
                    console.log("updated ticket", err, result);
                });
            }
        });
    });

    // Return any response, MessageBird won't parse this
    res.send("OK");
});

// Show tickets for customer support admin
app.get('/admin', function(req, res) {
    MongoClient.connect(dbUrl, {}, function(err, db) {
        // Find all open tickets
        var tickets = db.collection('tickets');
        tickets.find({ open : true }, {}).toArray(function(err, docs) {
            // Shorten ID
            for (d in docs) {
                docs[d].shortId = docs[d]._id.str.substring(18, 24);
            }
            // Show a page with tickets
            res.render('admin', {
                tickets : docs
            })
        });
    });
});

// Process replies to tickets
app.post('/reply', function(req, res) {
    MongoClient.connect(dbUrl, {}, function(err, db) {
        var tickets = db.collection('tickets');
        // Find existing ticket to reply to
        tickets.findOne({ '_id' : new mongo.ObjectId(req.body.id) }, function(err, doc) {
            if (doc != null) {
                // Add an outbound message to the existing ticket
                doc.messages.push({
                    direction : 'out',
                    content : req.body.content
                });
                tickets.updateOne({ '_id' : new mongo.ObjectId(req.body.id) }, {
                    $set: {
                        open : true,
                        messages : doc.messages
                    }
                }, function(err, result) {
                    console.log("updated ticket", err, result);
                });

                // Send reply to customer
                messagebird.messages.create({
                    originator : process.env.MESSAGEBIRD_ORIGINATOR,
                    recipients : [ doc.number ],
                    body : req.body.content
                }, function(err, response) {
                    console.log(err, response);
                });
            }
        });
    });
    // Return to previous page
    res.redirect('/admin');
});

// Start the application
app.listen(8080);