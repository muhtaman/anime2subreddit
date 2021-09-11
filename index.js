const fs = require("fs");
const url = require("url");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { Console } = require("console");
const querystring = require("querystring");

const port = 4300;
const server = http.createServer();
const {client_id, client_secret} = require("./auth/credentials.json");

server.on("listening", listen_handler);
server.listen(port);
function listen_handler(){
    console.log(`Now Listening on Port ${port}`);
}

server.on("request", request_handler);
function request_handler(req, res){
	console.log(`New Request from ${req.socket.remoteAddress} for ${req.url}`);
    if(req.url === "/"){
        const form = fs.createReadStream("./html/index.html");
		res.writeHead(200, {"Content-Type": "text/html"})
		form.pipe(res);
    }
    else if (req.url.startsWith("/search")){
		let {description} = url.parse(req.url,true).query;
		const regex = /^[a-z\d\-_\s]+$/i;
		if (description == "" || !description.match(regex) || description.length < 3) {
			res.write(`<h1>Invalid Input! Must be Alphanumeric!</h1>`);
			res.end(
				`<form action="search" method="get">
					<fieldset>
						<legend>Search Again?</legend>
						<label for="description">Anime:</label>
						<input id="description" name="description" type="text" />
						
						<input type="submit" value="Search" />
					</fieldset>
				</form>
				`
			);
		}
		else {
			console.log(description);
			get_anime_title(description, res);
		}	

	}
	
	else if(req.url.startsWith("/receive_code")) { 
		const {code} = url.parse(req.url, true).query;
			send_access_token_request(code, res);
		
	}


	else{
        res.writeHead(404, {"Content-Type": "text/html"});
        res.end(`<h1>404 Not Found</h1>`);
	}
	


}

function get_anime_title(description, res){
	const jikan_endpoint = `https://api.jikan.moe/v3/search/anime?q=${description}`;
	https.request(jikan_endpoint, {method:"GET"}, process_stream)
	     .end();
	function process_stream (anime_stream){
		let anime_data = "";
		anime_stream.on("data", chunk => anime_data += chunk);
		anime_stream.on("end", () => serve_results(anime_data, res));
	}
}

function serve_results(anime_data, res){
	let anime = JSON.parse(anime_data);
	title = anime.results[0].title; //This is where we start doing reddit api
	const state = crypto.randomBytes(20).toString("hex");

	const token_cache_location = './auth/authentication-res.json';
	let cache_valid = false;
	if (fs.existsSync(token_cache_location)) {
		cached_token_object = require(token_cache_location);
		if (new Date(cached_token_object.expiration) > Date.now()) {
			cache_valid = true;
		}
			
	}

	if (cache_valid) {
		let access_token = cached_token_object.access_token;
		console.log("Valid cache exists.");
		create_search_request(access_token, title, res);
	}

	else {
		console.log("There is no valid cache.");
		redirect_to_reddit(state, res);
	}	
}

// Gives us the authorization code needed to generate token
function redirect_to_reddit(state, res){ 
	const authorization_endpoint = `https://www.reddit.com/api/v1/authorize?client_id=${client_id}&response_type=code&state=${state}&redirect_uri=http://localhost:4300/receive_code&duration=permanent&scope=read`;
	res.writeHead(302, {Location: `${authorization_endpoint}`})
	   .end();
}

function send_access_token_request(codedata, res){
	let base64data = Buffer.from(`${client_id}:${client_secret}`).toString('base64');
	const options = {
		method: "POST",
		headers:{
			"Content-Type":"application/x-www-form-urlencoded",
			"Authorization":`Basic ${base64data}`
		}
	}
	const uri = "http://localhost:4300/receive_code";
	const post_data = querystring.stringify({grant_type : "client_credentials", code : `${codedata}`, redirect_uri : `${uri}`});
	const token_endpoint = "https://www.reddit.com/api/v1/access_token";
	const token_request_time = new Date();
	const token_request = https.request(token_endpoint, options);
	token_request.once("error", err => {throw err});
	token_request.once("response", (token_stream) => stream_to_message(token_stream, recieved_token, title, token_request_time, res));
	token_request.end(post_data);
}

function recieved_token(serial_token_object, title, token_request_time, res) {
	let token_object = JSON.parse(serial_token_object);
	let access_token = token_object.access_token;
	console.log(token_object);
	create_access_token_cache(token_object, token_request_time);
	create_search_request(access_token, title, res);
	
}

function create_access_token_cache(token_object, token_request_time) {
	token_object.expiration = new Date(token_request_time.getTime() + (token_object.expires_in * 1000));
	fs.writeFile('./auth/authentication-res.json', JSON.stringify(token_object), () => console.log("Access token cached."));
}

function create_search_request(access_token, title, res) {
	const options = {
		method: "GET",
		headers:{
			"Authorization":`Bearer ${access_token}`,
			"User-Agent": "PC:AnimetoSubreddit2:v1.0 (by /u/muhtaman)"
		}
	}
	const search_endpoint = `https://oauth.reddit.com/api/search_reddit_names?query=${title}`;
	const search_request = https.request(search_endpoint, options);
	search_request.once("error", err => {throw err});
	search_request.once("response", (search_result_stream) => stream_to_message(search_result_stream, recieved_search_result, res));
	search_request.end();
}

function recieved_search_result(serial_search_object, res) {
	let search_results = JSON.parse(serial_search_object);
	console.log(search_results);

	res.writeHead(200, "OK", {"Content-Type": "text/html"});
	res.write('<title>Anime to Subreddit Search</title>');
	res.write(`<h1>Here is your Closest Subreddit Match</h1>`);
	if (search_results.names.length == 0) {
		res.write(`Unable to find subreddit`);
	}
	else {
		res.write(`<a href="https://reddit.com/r/${search_results.names[0]}">https://reddit.com/r/${search_results.names[0]}</a>`);
	}
	res.write(
		`<form action="search" method="get">
			<fieldset>
				<legend>Search Again?</legend>
				<label for="description">Anime:</label>
				<input id="description" name="description" type="text" />
				
				<input type="submit" value="Search" />
			</fieldset>
		</form>
		`
	);
    	res.end();

	}


function stream_to_message(stream, callback, ...args) {
	let body = "";
	stream.on("data", chunk => body += chunk);
	stream.on("end", ()=> callback(body, ...args));
}
