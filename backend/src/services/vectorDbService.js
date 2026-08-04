// 1. Import the CloudClient from the chromadb package
const { CloudClient } = require("chromadb");

const dummyEmbeddingFunction = {
	generate: async (texts) => {
		return texts.map(() => []);
	},
};

class VectorDbService {
	constructor() {
		// 2. Initialize the CloudClient with your Chroma Cloud credentials
		this.client = new CloudClient({
			tenant: process.env.CHROMA_TENANT, // e.g., "default_tenant" or your specific tenant name
			database: process.env.CHROMA_DATABASE, // e.g., "default_database" or your specific database name
			apiKey: process.env.CHROMA_API_KEY, // Your Chroma Cloud API key
		});

		this.collectionName = "slack_chat_history";
		this.collection = null;
	}

	async init() {
		try {
			// 3. Pass the dummy function when getting/creating the collection
			this.collection = await this.client.getOrCreateCollection({
				name: this.collectionName,
				embeddingFunction: dummyEmbeddingFunction,
			});
			console.log("✅ Vector DB Connected & Collection Ready");
		} catch (error) {
			console.error("❌ Vector DB Connection Failed:", error.message);
		}
	}

	async saveMessage({
		messageId,
		threadId,
		text,
		vectorArray,
		senderId,
		senderName,
	}) {
		if (!this.collection) throw new Error("Vector DB not initialized!");

		await this.collection.add({
			ids: [messageId],
			embeddings: [vectorArray], // We provide our OpenAI vectors manually
			documents: [text],
			metadatas: [
				{
					thread_id: threadId,
					sender_id: senderId || "unknown",
					sender_name: senderName || "Unknown",
					timestamp: Date.now(),
				},
			],
		});

		console.log(`[Vector DB] Saved message: ${messageId}`);
	}

	async searchSimilarIssues(queryVectorArray) {
		if (!this.collection) throw new Error("Vector DB not initialized!");

		const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

		const results = await this.collection.query({
			queryEmbeddings: [queryVectorArray],
			nResults: 3,
			where: {
				timestamp: { $gte: thirtyDaysAgo },
			},
		});

		return results;
	}
}

module.exports = new VectorDbService();
