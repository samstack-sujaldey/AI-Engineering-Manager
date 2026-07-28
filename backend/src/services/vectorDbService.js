const { ChromaClient } = require("chromadb");

// 1. Create a dummy embedding function to bypass the default-embed crash
const dummyEmbeddingFunction = {
	generate: async (texts) => {
		return texts.map(() => []);
	},
};

class VectorDbService {
	constructor() {
		// 2. Fix deprecation warning by using host and port instead of 'path'
		this.client = new ChromaClient({
			host: "localhost",
			port: 8000,
			ssl: false,
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
