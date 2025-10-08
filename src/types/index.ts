export type Member = {
  id: string;
  name: string;
  phone: string;
  joinDate: string;
  totalDeposited: number;
  totalWithdrawn: number;
  currentBalance: number;
  interestEarned: number;
};

export type Transaction = {
  id: string;
  memberId: string;
  type: 'deposit' | 'withdrawal';
  amount: number;
  date: string;
  description: string;
  balanceAfter: number;
};

export type GroupSettings = {
  groupName: string;
  monthlyContribution: number;
  interestRate: number;
  totalMembers: number;
  totalFund: number;
  establishedDate: string;
};
