// init Web File System
const wfs = require("wfs-local");
const root = process.argv[3];
const drive = new wfs.LocalFiles(root, null, {
 	verbose: true
});


// init REST API
const fs = require("fs")
const cors = require("cors");
const path = require("path");
const Busboy = require("busboy");
const express = require("express");
const bodyParser = require("body-parser");
const { Readable, PassThrough } = require('stream')

const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true })); 

app.get("/info", async (req, res, next)=>{
	const id = req.query.id;
	const { free, used } = await drive.stats(id);
	res.send({
		stats:{ free, used, total: free+used },
		features:{ preview:{}, meta:{} }
	});
});

app.get("/files", async (req, res, next)=>{
	const id = req.query.id;
	const search = req.query.search;

	const config = {
		exclude: a => a.indexOf(".") === 0
	};
	if (search){
		config.subFolders = true;
		config.include = a => a.indexOf(search) !== -1;
	}

	res.send( await drive.list(id, config));
});

app.get("/folders", async (req, res, next)=>{
	res.send( await drive.list("/", {
		skipFiles: true,
		subFolders: true,
		nested: true,
		exclude: a => a.indexOf(".") === 0
	}));
});

app.get("/icons/:size/:type/:name", async (req, res, next)=>{
	const url = await getIconURL(req.params.size, req.params.type, req.params.name, "");
	res.sendFile(path.join(__dirname, url))
});

app.get("/icons/:skin/:size/:type/:name", async (req, res, next)=>{
	const url = await getIconURL(req.params.size, req.params.type, req.params.name, req.params.skin);
	res.sendFile(path.join(__dirname, url))
});

app.post("/copy", async (req, res, next)=>{
	const source = req.body.id;
	const target = req.body.to;

	res.send(await drive.info(await drive.copy(source, target, "", { preventNameCollision: true })));
});

app.post("/move", async (req, res, next)=>{
	const source = req.body.id;
	const target = req.body.to;

	res.send(await drive.info(await drive.move(source, target, "", { preventNameCollision: true })));
});

app.post("/rename", async (req, res, next)=>{
	const source = req.body.id;
	const target = path.dirname(source);
	const name = req.body.name;

	res.send(await drive.info(await drive.move(source, target, name, { preventNameCollision: true })));
});

app.post("/upload", async (req, res, next) => {
	const busboy = new Busboy({ headers: req.headers });

	const files = {};
	let path = [];

	busboy.on("field", async (field, val) => {
		if (field === "upload_fullpath") {
			path = val.split("/").slice(0, -1);
		}
	});

	busboy.on("file", async (field, file, name) => {
		console.log(req.body, name);
		files[name] = new PassThrough({ highWaterMark: 3.2e7 }); // buffer threshold - 32MB
		file.pipe(files[name]);
	});

	busboy.on("finish", async () => {
		let base = req.query.id;

		// support folder upload
		for (let i = 0; i < path.length; ++i) {
			const p = path[i];
			const newBase = base + "/" + p;
			if (await drive.exists(newBase)) {
				base = newBase;
			} else {
				base = await drive.make(base, p, true);
			}
		}

		for (const name in files) {
			const target = await drive.make(base, name, false, {
				preventNameCollision: true,
			});
			res.send(await drive.info(await drive.write(target, files[name])));
		}
	});

	req.pipe(busboy);
});

app.post("/makedir", async (req, res, next)=>{
	const id = await drive.make(req.body.id, req.body.name, true, { preventNameCollision: true })
	res.send(await drive.info(id));
});

app.post("/makefile", async (req, res, next)=>{
	const id = await drive.make(req.body.id, req.body.name, false, { preventNameCollision: true })
	res.send(await drive.info(id));
});

app.post("/delete", async (req, res, next)=>{
	drive.remove(req.body.id)
	res.send({})
});	

app.post("/text", async (req, res, next)=>{
	const name = req.body.id;
	const content = req.body.content;
	const id = await drive.write(name, Readable.from([content]));
	res.send(await drive.info(id));
});

app.get("/text", async (req, res, next)=>{
	const data = await drive.read(req.query.id);
	data.pipe(res);
});

app.get("/direct", async (req, res, next) => {
	const id = req.query.id;
	const data = await drive.read(req.query.id);
	const info = await drive.info(req.query.id);
	const name = encodeURIComponent(info.value);

	let disposition = "inline";
	if (req.query.download){
		disposition = "attachment";
	}

	res.writeHead(200, {
		"Content-Disposition": `${disposition}; filename=${name}`
	});
	data.pipe(res);
});

async function getIconURL(size, type, name, skin){
	size = size.replace(/[^A-Za-z0-9.]/g, "");
	name = name.replace(/[^A-Za-z0-9.]/g, "");
	type = type.replace(/[^A-Za-z0-9.]/g, "");
	skin = skin.replace(/[^A-Za-z0-9.]/g, "");

	const names = [
		// get by name
		`icons/default/${size}/${name}`,
		// get by type with skin or not
		( skin ? `icons/${skin}/${size}/types/${type}.svg` : null),
		`icons/default/${size}/types/${type}.svg`
	].filter(a => a);

	for (let i = 0; i < names.length-1; i++){
		try {
			await fs.promises.stat(names[i]);
			return names[i];
		} catch (e) { }
	}

	return names[names.length-1];
}



// load other assets
app.use(express.static("./"));

const port = "3200";
const host = "localhost";
app.listen(port, host, function () {
	console.log("Server is running on port " + port + "...");
});
