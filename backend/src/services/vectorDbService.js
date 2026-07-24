const { ChromaClient } = require("chromadb");

class VectorDbService {
	constructor() {
		// 1. Tell the app where the Docker container is running
		this.client = new ChromaClient({ path: "http://localhost:8000" });

		// 2. This is like your MongoDB "Collection" name
		this.collectionName = "slack_chat_history";
		this.collection = null;
	}

	// 3. This runs when your server starts up
	async init() {
		try {
			// It looks for the collection, and creates it if it's your first time booting up
			this.collection = await this.client.getOrCreateCollection({
				name: this.collectionName,
			});
			console.log("✅ Vector DB Connected & Collection Ready");
		} catch (error) {
			console.error("❌ Vector DB Connection Failed:", error.message);
		}
	}

	/**
	 * SAVING DATA (Your friend calls this after OpenAI makes the vector)
	 */
	async saveMessage({ messageId, threadId, text, vectorArray }) {
		if (!this.collection) throw new Error("Vector DB not initialized!");

		await this.collection.add({
			ids: [messageId], // Unique Slack message TS
			embeddings: [vectorArray], // The massive array of numbers from OpenAI
			documents: [text], // The actual readable text
			metadatas: [
				{
					// Extra tags so we can filter by thread or date later
					thread_id: threadId,
					timestamp: Date.now(),
				},
			],
		});

		console.log(`[Vector DB] Saved message: ${messageId}`);
	}

	/**
	 * SEARCHING DATA (Your friend calls this to find similar past issues)
	 */
	async searchSimilarIssues(queryVectorArray) {
		if (!this.collection) throw new Error("Vector DB not initialized!");

		// Only search the last 30 days of data
		const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

		const results = await this.collection.query({
			queryEmbeddings: [queryVectorArray], // The numbers for the NEW issue
			nResults: 3, // Return the top 3 closest matches
			where: {
				timestamp: { $gte: thirtyDaysAgo }, // The 30-day filter
			},
		});

		// Returns an object containing the matching text and IDs
		return results;
	}
}

// Export a single instance so the whole app shares the same connection
module.exports = new VectorDbService();
