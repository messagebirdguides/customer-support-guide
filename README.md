# SMS Customer Support

People love communicating with each other through short text messaging on their phones and getting quick replies. Hence, as customers, they want the same easy way of contact when they need support from a business.  Companies, on the other side, need to organize communication with their customers and often resort to ticket systems to combine all messages for specific cases in a shared view for support agents.

In this guide, we'll demonstrate a simple customer support system for SMS-based communication between consumers and companies, built in NodeJS.

Our sample application has the following features:
- Customers can send any message to a virtual mobile number (VMN) created and published by the company. Their message becomes a support ticket, and they receive an automated confirmation with a ticket ID for their reference.
- Any subsequent message from the same number is added to the same support ticket. There's no additional confirmation.
- Support agents can view all messages in a web view and reply to them.

## Getting Started

Our sample application uses NodeJS and [Express](https://expressjs.com/). Thus you need to have Node and npm installed on your computer to run it. You can [install them from npmjs.com](https://www.npmjs.com/get-npm).

We've provided the source code [in a GitHub repository](https://github.com/messagebirdguides/customer-support-guide), so you can either clone the sample application with git or download a ZIP file with the code to your computer.

To install Express, the [MessageBird SDK for NodeJS](https://www.npmjs.com/package/messagebird) and other dependencies, open a console pointed at the directory into which you've put the sample application and run the following command:

````bash
npm install
````

We use [mongo-mock](https://www.npmjs.com/package/mongo-mock) to provide an in-memory database for testing, so you don't need to configure an external database. If you want to extend the sample into a production application, you can replace mongo-mock with real MongoDB.

## Prerequisites for Receiving Messages

### Overview

The support system receives incoming messages. From a high-level viewpoint, receiving with MessageBird is relatively simple: an application defines a _webhook URL_, which you assign to a number purchased on the MessageBird Dashboard using a flow. A [webhook](https://en.wikipedia.org/wiki/Webhook) is a URL on your site that doesn't render a page to users but is like an API endpoint that can be triggered by other servers. Every time someone sends a message to that number, MessageBird collects it and forwards it to the webhook URL, where you can process it.

### Exposing your Development Server with localtunnel

When working with webhooks, an external service like MessageBird needs to access your application, so the webhook URL must be public. During development, though, you're typically working in a local development environment that is not publicly available. Thankfully this is not a massive roadblock since various tools and services allow you to quickly expose your development environment to the Internet by providing a tunnel from a public URL to your local machine. One of these tools is [localtunnel.me](https://localtunnel.me), which is uniquely suited to NodeJS developers since you can easily install it using npm:

````bash
npm install -g localtunnel
````

You can start a tunnel by providing a local port number on which your application runs. Our application is configured to run on port 8080, so you can launch a tunnel with the following command:

````bash
lt --port 8080
````

After you've started the tunnel, localtunnel displays your temporary public URL. We'll need that in a minute.

If you're facing problems with localtunnel.me, you can have a look at other common tools such as [ngrok](https://ngrok.com), which works in virtually the same way.

### Getting an Inbound Number

A requirement for receiving messages is a dedicated inbound number. Virtual mobile numbers look and work similar like regular mobile numbers, however, instead of being attached to a mobile device via a SIM card, they live in the cloud, i.e., a data center, and can process incoming SMS and voice calls. MessageBird offers numbers from different countries for a low monthly fee. Here's how to purchase one:

1. Go to the [Numbers](https://dashboard.messagebird.com/en/numbers) section of your MessageBird account and click **Buy a number**.
2. Choose the country in which you and your customers are located and make sure the _SMS_ capability is selected.
3. Choose one number from the selection and the duration for which you want to pay now. ![Buy a number screenshot](buy-a-number.png)
4. Confirm by clicking **Buy Number**.

Awesome, you have set up your first virtual mobile number! Check out the [Numbers](https://support.messagebird.com/hc/en-us/sections/201958489-Numbers) section in the Help Center for more information.

### Connecting the Number to a Webhook

So you have a number now, but MessageBird has no idea what to do with it. That's why you need to define a _Flow_ next that ties your number to your webhook. Here is one way to achieve that:

1. Go to the [Flow Builder](https://dashboard.messagebird.com/en/flow-builder) section of your MessageBird account. Under _Create a New Flow_, you'll see a list of templates. Find the one named "SMS to HTTP" and click "Use this flow".
2. Give your flow a name, such as "Support Receiver".
3. The flow contains two steps. On the first step, the trigger "Incoming SMS", tick the box next to your number and **Save**.
4. Click on the second step, "Forward to URL". Choose _POST_ as the method, copy the output from the `lt` command in the previous step and add `/webhook` to the end of it - this is the name of the route we use to handle incoming messages. Click **Save**.
5. Click **Publish Changes** to activate your flow.

## Configuring the MessageBird SDK

The MessageBird SDK and an API key are not required to receive messages. However, since we want to send replies, we need to add and configure it. The SDK is defined in `package.json` and loaded with a statement in `index.js`:

````javascript
// Load and initialize MesageBird SDK
var messagebird = require('messagebird')(process.env.MESSAGEBIRD_API_KEY);
````

You need to provide a MessageBird API key, as well as the phone number you registered so that you can use it as the originator, via environment variables loaded with [dotenv](https://www.npmjs.com/package/dotenv). We've prepared an `env.example` file in the repository, which you should rename to `.env` and add the required information. Here's an example:

````env
MESSAGEBIRD_API_KEY=YOUR-API-KEY
MESSAGEBIRD_ORIGINATOR=+31970XXXXXXX
````

You can create or retrieve a live API key from the [API access (REST) tab](https://dashboard.messagebird.com/en/developers/access) in the _Developers_ section of your MessageBird account.

## Receiving Messages

Now that the preparations for receiving messages are complete, we'll implement the `app.post('/webhook')` route:

````javascript
// Handle incoming webhooks
app.post('/webhook', function(req, res) {
    // Read input sent from MessageBird
    var number = req.body.originator;
    var text = req.body.payload;
````

MessageBird sends a few fields for incoming messages. We're interested in two of them: the originator, which is the number that the message came from (tip: don't confuse it with the originator you configured, which is for _outgoing_ messages), and the payload, which is the content of the text message.

````javascript
    MongoClient.connect(dbUrl, {}, function(err, db) {
        // Find ticket for number in our database
        var tickets = db.collection('tickets');
        tickets.findOne({ number : number }, function(err, doc) {
````

The number is used to look up the ticket. If none exists, we create a new ticket and add one inbound message to it:

````javascript
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
````

As you can see, we store the whole message history in a single Mongo document using an array called `messages`. In the callback for the Mongo insert function we send the ticket confirmation to the user:

````javascript
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
````

Let's unpack this. First, we take an excerpt of the autogenerated MongoDB ID because the full ID is too long and the last 6 digits are unique enough for our purpose. Then, we call `messagebird.messages.create()` to send a confirmation message. Three parameters are passed to the API:
- Our configured originator, so that the receiver sees a reply from the number which they contacted in the first place.
- A recipient array with the number from the incoming message so that the reply goes back to the right person.
- The body of the message, which contains the ticket ID.

So, what if a ticket already exists? In this case (our `else` block) we'll add a new message to the array and store the updated document. No need to send another confirmation.

````javascript
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
````

Servers sending webhooks typically expect you to return a response with a default 200 status code to indicate that their webhook request was received, but they do not parse the response. Therefore we send the string _OK_ at the end of the route handler, independent of the case that we handled.

````javascript
    // Return any response, MessageBird won't parse this
    res.send("OK");
````

## Reading Messages

Customer support team members can view incoming tickets from an admin view. We have implemented a simple admin view in the `app.get('/admin')` route. The approach is straightforward: request all documents representing open tickets from MongoDB, convert IDs as explained above and then pass them to a [Handlebars](http://handlebarsjs.com/) template.

The template is stored in `views/admin.handlebars`. Apart from the HTML that renders the documents, there is a small Javascript section in it that refreshes the page every 10 seconds. Thanks to this you can keep the page open and will receive messages automatically with only a small delay and without the implementation of Websockets.

This is the implementation of the route:

````javascript
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
````

## Replying to Messages

The admin template also contains a form for each ticket through which you can send replies. The implementation uses `messagebird.messages.create()` analogous to the confirmation messages we're sending for new tickets. If you're curious about the details, you can look at the `app.post('/reply')` implementation route in `index.js`.

## Testing the Application

Check again that you have set up your number correctly with a flow that forwards incoming messages to a localtunnel URL and that the tunnel is still running. Remember, whenever you start a fresh tunnel with the `lt` command, you'll get a new URL, so you have to update the flow accordingly.

To start the application you have to enter another command, but your existing console window is already busy running your tunnel. Therefore you need to open another one. On a Mac you can press _Command_ + _Tab_ to open a second tab that's already pointed to the correct directory. With other operating systems you may have to resort to manually opening another console window. Either way, once you've got a command prompt, type the following to start the application:

````bash
node index.js
````

Open http://localhost:8080/admin in your browser. You should see an empty list of tickets. Then, take out your phone, launch the SMS app and send a message to your virtual mobile number. Around 10-20 seconds later, you should see your message in the browser! Amazing! Try again with another message which will be added to the ticket, or send a reply.

Congratulations, you just learned how to handle inbound messages with MessageBird and how to use them as a support system!
