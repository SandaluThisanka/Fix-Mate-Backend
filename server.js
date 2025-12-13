import express from "express";
import cors from "cors";
import Stripe from "stripe";
import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Firebase
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
});

const db = admin.firestore();

// ---- PAYMENT ROUTE ----
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount, userId } = req.body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: "usd",
    });

    await db.collection("payments").add({
      userId,
      amount,
      status: "pending",
      createdAt: new Date(),
    });

    res.json({ clientSecret: paymentIntent.client_secret });

  } catch (error) {
    console.log(error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/", (req, res) => {
  res.send("FixMate Payment Backend Running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
