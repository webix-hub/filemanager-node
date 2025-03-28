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
	const filter = req.query.filter ? JSON.parse(req.query.filter) : null;
	const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;

	const config = {
		exclude: file => file.value.startsWith(".")
	};

	if (search || filter) {
		const fileFilter = createFileFilter(filter);
		config.subFolders = true;
		config.include = file => file.value.includes(search) && fileFilter(file);
	}

	let files = await drive.list(id, config);
	if (limit) {
		res.send({
			files: files.slice(0, limit),
			total: files.length,
		});
	} else {
		res.send(files);
	}
});

app.get("/folders", async (req, res, next)=>{
	res.send( await drive.list("/", {
		skipFiles: true,
		subFolders: true,
		nested: true,
		exclude: file => file.value.indexOf(".") === 0
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

function createFileFilter(filter) {
	if (!filter) return () => true;

	const { type, date, size } = filter;

	const filterByType = type ?
		file => type.includes(file.type) :
		() => true;

	const filterByDate = date ?
		file => {
			const fileDate = new Date(file.date * 1000).toISOString();
			return date.start <= fileDate && fileDate < date.end;
		} :
		() => true;

	const filterBySyze = size ?
		file => size.some(range =>
			range.start <= file.size && (range.end === 0 || file.size <= range.end)
		) :
		() => true;

	return file => filterByType(file) && filterByDate(file) && filterBySyze(file);
}

// load other assets
app.use(express.static("./"));

const port = "3200";
const host = "localhost";
app.listen(port, host, function () {
	console.log("Server is running on port " + port + "...");
});
