# **App Name**: Sahayak Savings

## Core Features:

- Member Management: Add, update, and view member details including personal information, contact details, and join date. This feature reads and writes member data to the Firestore database.
- Transaction Tracking: Record deposits and withdrawals for each member, including transaction date, amount, and description. All data are kept in the Firestore database.
- Balance Calculation: Automatically calculate and display the current balance for each member based on their deposit and withdrawal history.
- Group Settings: Configure and manage group-level settings such as group name, monthly contribution amount, and interest rate. All data are persisted to the Firestore database.
- Real-time Updates: Utilize Firebase Realtime Database to provide real-time updates to all users regarding member data, transactions, and group settings.
- Secure Authentication: Implement secure user authentication using Firebase Authentication to protect sensitive financial data.

## Style Guidelines:

- Primary color: Deep Indigo (#3F51B5) for a sense of trust and security.
- Background color: Very light Lavender (#E8EAF6).
- Accent color: Teal (#009688) to highlight important actions and information.
- Headline font: 'Poppins' (sans-serif) for a modern and clear presentation. Body font: 'PT Sans' (sans-serif) for readability.
- Use simple and intuitive icons to represent different actions and data points, enhancing usability.
- Design a clean and responsive layout that is accessible on various devices and screen sizes.
- Incorporate subtle animations to provide feedback on user actions and enhance the overall user experience.