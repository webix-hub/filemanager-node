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
const { Readable } = require('stream')

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

app.get("/icons/:skin/:size/:type/:name", async (req, res, next)=>{
	url = await getIconURL(req.params.size, req.params.type, req.params.name, req.params.skin);
	res.sendFile(path.join(__dirname, url))
})


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

app.post("/upload", async (req, res, next)=>{
	const busboy = new Busboy({ headers: req.headers });
						
	busboy.on("file", async (field, file, name) => {
		console.log(req.body, name)

		busboy.on('field', async function(field, val) {
			// support folder upload
			let base = req.query.id;
			
			const parts = val.split("/");
			if (parts.length > 1){
				for (let i = 0; i < parts.length - 1; ++i){
					const p = parts[i];
					const exists = await drive.exists(base + "/" + p);
					if (!exists) {
						base = await drive.make(base, p, true);
					} else {
						base = base + "/" + p;
					}
				}
			}

			const target = await drive.make(base, name, false, { preventNameCollision: true });
			res.send(await drive.info(await drive.write(target, file)));
		});
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

	name = "icons/" + size + "/" + name;

	try {
		const stat = await fs.promises.stat(name);
	} catch(e){
		name = "icons/" + size + "/types/" + skin + "/" + type + ".svg";
	}

	try {
		const stat = await fs.promises.stat(name);
	} catch(e){
		name = "icons/" + size + "/types/" + type + ".svg";
	}

	return name
}



// load other assets
app.use(express.static("./"));

const port = "3200";
const host = "localhost";
var server = app.listen(port, host, function () {
	console.log("Server is running on port " + port + "...");
});
