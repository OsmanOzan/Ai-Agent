import React, { useState, useEffect } from "react";
import "./App.css";
import { collection, addDoc, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "./firebase";

// Backend API base URL
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL;

function getToken() {
  return localStorage.getItem("token");
}

async function login(userid: string, password: string) {
  const response = await fetch(`${API_BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userid, password })
  });
  if (!response.ok) throw new Error("Login failed");
  const data = await response.json();
  localStorage.setItem("token", data.token);
  return data.token;
}

async function fetchBill(subscriberNo: string, month?: string, year?: number) {
  const token = getToken();
  let url = `${API_BASE_URL}/api/bill/${subscriberNo}`;
  if (month && year) {
    url += `?month=${month}&year=${year}`;
  }
  const response = await fetch(url, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  return response.json();
}

async function fetchBillDetail(subscriberNo: string, year: number, month: number) {
  const token = getToken();
  const response = await fetch(`${API_BASE_URL}/api/bill-detail/${subscriberNo}/${year}/${month}`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  return response.json();
}

async function payBill(subscriberNo: string, year: number, month: number, amount: number) {
  const token = getToken();
  const response = await fetch(`${API_BASE_URL}/api/pay-bill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', "Authorization": `Bearer ${token}` },
    body: JSON.stringify({ subscriber_no: subscriberNo, year, month, amount })
  });
  return response.json();
}

async function parseIntent(message: string): Promise<any> {
  const token = getToken();
  const response = await fetch(`${API_BASE_URL}/api/parse-intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', "Authorization": `Bearer ${token}` },
    body: JSON.stringify({ message })
  });
  return response.json();
}

type Message = {
  id: number;
  sender: "user" | "agent";
  text: string;
  type?: "text" | "bill" | "bill_detail" | "payment_success";
  data?: any;
};

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(!!getToken());
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");

  const handleLogout = () => {
    localStorage.removeItem("token");
    setIsLoggedIn(false);
    setMessages([]);
  };

  async function safeApiCall<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (e: any) {
      if (e && e.message && e.message.includes("401")) {
        handleLogout();
      }
      return undefined;
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    try {
      const token = await login(loginUser, loginPass);
      await fetch(`${API_BASE_URL}/api/clear-messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setMessages([]);
      setIsLoggedIn(true);

      const welcomeMsg = {
        id: Date.now() + Math.random(),
        sender: "agent" as const,
        text: "Welcome! How can I assist you today?",
        type: "text" as const,
        createdAt: new Date(),
      };
      await addDoc(collection(db, "messages"), welcomeMsg);
    } catch {
      setLoginError("Login failed. Please check your credentials.");
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    const userMsg = {
      id: Date.now(),
      sender: "user" as const,
      text: input,
      type: "text" as const,
      createdAt: new Date(),
    };
    await addDoc(collection(db, "messages"), userMsg);
    setInput("");

    let intentResult: any = null;
    try {
      intentResult = await parseIntent(input);
      console.log("LLM intent result:", intentResult);
    } catch (e) {
      const agentMsg = {
        id: Date.now() + 1,
        sender: "agent" as const,
        text: "Sorry, I couldn't understand your request.",
        type: "text" as const,
        createdAt: new Date(),
      };
      await addDoc(collection(db, "messages"), agentMsg);
      return;
    }

    if (intentResult && intentResult.intent === "query_bill_detail" && intentResult.subscriber_no && intentResult.year && intentResult.month) {
      setLoading(true);
      const billDetailData = await fetchBillDetail(intentResult.subscriber_no, intentResult.year, intentResult.month);
      setLoading(false);
      if (billDetailData && !billDetailData.error) {
        const agentMsg = {
          id: Date.now() + Math.random(),
          sender: "agent" as const,
          text: `Here are the bill details for subscriber ${intentResult.subscriber_no}, ${intentResult.month} ${intentResult.year}:`,
          type: "bill_detail" as const,
          data: billDetailData,
          createdAt: new Date(),
        };
        await addDoc(collection(db, "messages"), agentMsg);
      } else {
        const agentMsg = {
          id: Date.now() + Math.random(),
          sender: "agent" as const,
          text: `No detailed bill found for subscriber ${intentResult.subscriber_no}.`,
          type: "text" as const,
          createdAt: new Date(),
        };
        await addDoc(collection(db, "messages"), agentMsg);
      }
      return;
    }

    if (intentResult && intentResult.intent === "pay_bill" && intentResult.subscriber_no && intentResult.year && intentResult.month && intentResult.amount) {
      setLoading(true);
      const paymentResult = await payBill(intentResult.subscriber_no, intentResult.year, intentResult.month, intentResult.amount);
      setLoading(false);
      if (paymentResult && !paymentResult.error) {
        const agentMsg = {
          id: Date.now() + Math.random(),
          sender: "agent" as const,
          text: "Payment successful!",
          type: "payment_success" as const,
          data: paymentResult,
          createdAt: new Date(),
        };
        await addDoc(collection(db, "messages"), agentMsg);
      } else {
        const agentMsg = {
          id: Date.now() + Math.random(),
          sender: "agent" as const,
          text: `Payment failed for subscriber ${intentResult.subscriber_no}.`,
          type: "text" as const,
          createdAt: new Date(),
        };
        await addDoc(collection(db, "messages"), agentMsg);
      }
      return;
    }

    if (intentResult && intentResult.intent === "query_bill" && intentResult.subscriber_no) {
      setLoading(true);
      const billData = await fetchBill(
        intentResult.subscriber_no,
        intentResult.month,
        intentResult.year
      );
      setLoading(false);
      if (billData && billData.length > 0) {
        const bill = billData[0];
        const agentMsg = {
          id: Date.now() + Math.random(),
          sender: "agent" as const,
          text: `Here is the bill summary for subscriber ${intentResult.subscriber_no}:`,
          type: "bill" as const,
          data: bill,
          createdAt: new Date(),
        };
        await addDoc(collection(db, "messages"), agentMsg);
      } else if (billData && billData.error) {
        const agentMsg = {
          id: Date.now() + Math.random(),
          sender: "agent" as const,
          text: billData.error,
          type: "text" as const,
          createdAt: new Date(),
        };
        await addDoc(collection(db, "messages"), agentMsg);
      } else {
        const agentMsg = {
          id: Date.now() + Math.random(),
          sender: "agent" as const,
          text: `No bill found for subscriber ${intentResult.subscriber_no}.`,
          type: "text" as const,
          createdAt: new Date(),
        };
        await addDoc(collection(db, "messages"), agentMsg);
      }
    } else {
      const agentMsg = {
        id: Date.now() + 1,
        sender: "agent" as const,
        text: "Please ask for a bill by typing: What's the bill for subscriber <number>?",
        type: "text" as const,
        createdAt: new Date(),
      };
      await addDoc(collection(db, "messages"), agentMsg);
    }
  };

  useEffect(() => {
    if (!isLoggedIn) return;
    const q = query(collection(db, "messages"), orderBy("createdAt"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setMessages(
        snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: data.id ?? doc.id,
            sender: data.sender,
            text: data.text,
            type: data.type,
            data: data.data,
            createdAt: data.createdAt ? new Date(data.createdAt.seconds ? data.createdAt.seconds * 1000 : data.createdAt) : new Date(),
          } as Message;
        })
      );
    });
    return () => unsubscribe();
  }, [isLoggedIn]);

  if (!isLoggedIn) {
    return (
      <div className="chat-container">
        <header className="chat-header">Login</header>
        <form className="chat-input" onSubmit={handleLogin} style={{ flexDirection: "column", gap: 8 }}>
          <input
            value={loginUser}
            onChange={e => setLoginUser(e.target.value)}
            placeholder="User ID"
            style={{ marginBottom: 8 }}
          />
          <input
            value={loginPass}
            onChange={e => setLoginPass(e.target.value)}
            placeholder="Password"
            type="password"
            style={{ marginBottom: 8 }}
          />
          <button type="submit">Login</button>
          {loginError && <div style={{ color: "red", marginTop: 8 }}>{loginError}</div>}
        </form>
      </div>
    );
  }

  return (
    <div className="chat-container">
      <header className="chat-header">
        Agent
        <button style={{ float: "right", marginLeft: 8 }} onClick={handleLogout}>Logout</button>
      </header>
      <div className="chat-messages">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-bubble ${msg.sender === "user" ? "user" : "agent"}`}
          >
            {msg.type === "text" && <span>{msg.text}</span>}
            {msg.type === "bill" && msg.data && (
              <div className="bill-summary">
                <strong>Bill Summary:</strong>
                <div>Subscriber No: {msg.data.subscriber_no}</div>
                <div>Year: {msg.data.year}</div>
                <div>Month: {msg.data.month}</div>
                <div>Phone Minutes Used: {msg.data.phone_minutes_used}</div>
                <div>Internet Used (MB): {msg.data.internet_used_mb}</div>
                <div>Total Amount: ${msg.data.total_amount}</div>
                <div>Paid: {msg.data.is_paid ? "Yes" : "No"}</div>
              </div>
            )}
            {msg.type === "bill_detail" && msg.data && (
              <div className="bill-details">
                <strong>Bill Details for {msg.data.month}:</strong>
                <div>Base Plan: ${msg.data.base_plan}</div>
                <div>Data Usage (Extra): ${msg.data.data_usage_extra}</div>
                <div>VAT/Taxes: ${msg.data.vat_taxes}</div>
                <div>Total Due: ${msg.data.total_due}</div>
                <div>Due Date: {msg.data.due_date}</div>
              </div>
            )}
            {msg.type === "payment_success" && msg.data && (
              <div className="payment-success">
                <strong>Payment Summary:</strong>
                <div>Subscriber: {msg.data.subscriber_no}, {msg.data.month}</div>
                <div>Amount: ${msg.data.amount}</div>
              </div>
            )}
          </div>
        ))}
        {loading && <div className="chat-bubble agent">Loading...</div>}
      </div>
      <div className="chat-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message... (e.g. What's the bill for subscriber 1001?)"
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
        />
        <button onClick={handleSend}>Send</button>
      </div>
    </div>
  );
}

export default App;
