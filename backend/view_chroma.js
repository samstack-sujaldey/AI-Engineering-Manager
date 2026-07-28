const { ChromaClient } = require("chromadb");

const dummyEmbeddingFunction = {
	generate: async (texts) => texts.map(() => []),
};

async function viewData() {
	try {
		const client = new ChromaClient({
			host: "localhost",
			port: 8000,
			ssl: false,
		});

		// getOrCreateCollection prevents the "resource not found" error
		const collection = await client.getOrCreateCollection({
			name: "slack_chat_history",
			embeddingFunction: dummyEmbeddingFunction,
		});

		const count = await collection.count();
		console.log(`\n Total documents stored: ${count}\n`);

		if (count > 0) {
			const results = await collection.get({ limit: 5 });
			console.log(JSON.stringify(results, null, 2));
		} else {
			console.log(
				"Collection exists but is empty. Run your refresh/pipeline sync to populate it!",
			);
		}
	} catch (error) {
		console.error("Error fetching data:", error.message);
	}
}

viewData();
