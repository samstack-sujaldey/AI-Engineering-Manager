// 1. Import the CloudClient from the chromadb package
const { ChromaClient } = require("chromadb");

const dummyEmbeddingFunction = {
	generate: async (texts) => {
		return texts.map(() => []);
	},
};

class VectorDbService {
	constructor() {
		// Safely parse the URL to extract the host, port, and protocol
		const chromaUrl = new URL(
			process.env.CHROMA_URL,
		);

		// Initialize the standard ChromaClient for self-hosted instances
		this.client = new ChromaClient({
			ssl: chromaUrl.protocol === "https:",
			host: chromaUrl.hostname,
			port: parseInt(
				chromaUrl.port ||
					(chromaUrl.protocol === "https:" ? "443" : "80"),
			),
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
