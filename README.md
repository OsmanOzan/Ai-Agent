# Ai-Agent
Ai agent Project for Assignment 2

https://youtu.be/_yid6CAaoAk

I developed a chat application based on React.
Users can log in; upon login, a JWT token is obtained and I store it in localStorage.
There is a chat interface on the main page. When a user sends a message:
I add the message to Firestore.
I send the message to an LLM (most likely a backend API) for intent analysis.
For operations like bill inquiry, bill details, and bill payment, I make requests to the backend API.
I display the results again on the chat screen.
I use Firebase Firestore to store messages and update them in real time.
I implemented essential user experience features such as login/logout, error handling, and loading states.
I started the project with Create React App.
I communicate with backend APIs

CREATE TABLE Subscribers (
    subscriber_no INT PRIMARY KEY,
    name NVARCHAR(100)
);
CREATE TABLE [Usage] (
    id INT IDENTITY(1,1) PRIMARY KEY,
    subscriber_no INT,
    year INT,
    month INT,
    usage_type VARCHAR(10) CHECK (usage_type IN ('Phone', 'Internet')),
    amount INT,
    FOREIGN KEY (subscriber_no) REFERENCES Subscribers(subscriber_no)
);
CREATE TABLE Bills (
    id INT IDENTITY(1,1) PRIMARY KEY,
    subscriber_no INT,
    year INT,
    month INT,
    phone_minutes_used INT DEFAULT 0,
    internet_used_mb INT DEFAULT 0,
    total_amount DECIMAL(10,2),
    is_paid BIT DEFAULT 0,
    FOREIGN KEY (subscriber_no) REFERENCES Subscribers(subscriber_no)
);
CREATE TABLE BillPayments (
    id INT IDENTITY(1,1) PRIMARY KEY,
    bill_id INT,
    payment_date DATETIME DEFAULT GETDATE(),
    amount_paid DECIMAL(10,2),
    FOREIGN KEY (bill_id) REFERENCES Bills(id)
);
INSERT INTO Subscribers (subscriber_no, name) VALUES
(1001, 'Ali Yılmaz'),
(1002, 'Ayşe Demir'),
(1003, 'Mehmet Kaya'),
(1004, 'Elif Çetin'),
(1005, 'Ahmet Şahin');
INSERT INTO Bills (subscriber_no, year, month, phone_minutes_used, internet_used_mb, total_amount, is_paid) VALUES
(1001, 2025, 4, 800, 18000, 50.00, 1),
(1002, 2025, 4, 1200, 25000, 65.00, 0),
(1003, 2025, 4, 500, 15000, 50.00, 1),
(1004, 2025, 4, 2000, 40000, 90.00, 0),
(1005, 2025, 4, 1000, 20000, 50.00, 0);
INSERT INTO BillPayments (bill_id, amount_paid) VALUES
(1, 50.00),
(3, 50.00);




