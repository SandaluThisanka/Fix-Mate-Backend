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

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "OK", 
    message: "FixMate Payment Backend is running",
    timestamp: new Date().toISOString()
  });
});

app.get("/", (req, res) => {
  res.send("FixMate Payment Backend Running - Use /health for status");
});

// ---- PAYMENT ROUTES ----
// Create Payment Intent
app.post("/api/payments/create-intent", async (req, res) => {
  try {
    const { bookingId, amount, customerId, providerId } = req.body;

    console.log("Creating payment intent:", { bookingId, amount, customerId, providerId });

    // Validate input
    if (!bookingId || !amount || !customerId || !providerId) {
      return res.status(400).json({ 
        error: "Missing required fields: bookingId, amount, customerId, providerId" 
      });
    }

    // Create Stripe payment intent
    // Convert amount to smallest currency unit (paisa for LKR)
    // If amount is 408.00 LKR, we need 40800 paisa
    const amountInSmallestUnit = Math.round(amount * 100);
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInSmallestUnit,
      currency: "lkr",
      metadata: {
        bookingId,
        customerId,
        providerId
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    console.log("Payment intent created:", paymentIntent.id);

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    });
  } catch (error) {
    console.error("Error creating payment intent:", error);
    res.status(500).json({ error: error.message });
  }
});

// Confirm Payment
app.post("/api/payments/confirm", async (req, res) => {
  try {
    const { paymentIntentId, bookingId } = req.body;

    console.log("Confirming payment:", { paymentIntentId, bookingId });

    // Retrieve payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status === "succeeded") {
      // Update booking status in Firestore
      await db.collection("bookings").doc(bookingId).update({
        status: "COMPLETED",
        "pricing.paymentStatus": "COMPLETED",
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Create payment record
      await db.collection("payments").add({
        bookingId,
        paymentIntentId,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency,
        status: "COMPLETED",
        method: "CARD",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log("Payment confirmed and booking updated");

      res.json({
        success: true,
        message: "Payment confirmed successfully",
        paymentStatus: "COMPLETED",
        bookingStatus: "COMPLETED"
      });
    } else {
      res.status(400).json({
        success: false,
        message: `Payment status is ${paymentIntent.status}`
      });
    }
  } catch (error) {
    console.error("Error confirming payment:", error);
    res.status(500).json({ error: error.message });
  }
});

// Process Cash Payment
app.post("/api/payments/cash", async (req, res) => {
  try {
    const { bookingId, amount, customerId, providerId } = req.body;

    console.log("Processing cash payment:", { bookingId, amount, customerId, providerId });

    // Update booking status
    await db.collection("bookings").doc(bookingId).update({
      status: "COMPLETED",
      "pricing.paymentStatus": "COMPLETED",
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Create payment record
    const paymentRef = await db.collection("payments").add({
      bookingId,
      amount,
      currency: "LKR",
      status: "COMPLETED",
      method: "CASH",
      customerId,
      providerId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log("Cash payment processed:", paymentRef.id);

    res.json({
      success: true,
      message: "Cash payment processed successfully",
      paymentId: paymentRef.id,
      bookingStatus: "COMPLETED"
    });
  } catch (error) {
    console.error("Error processing cash payment:", error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
