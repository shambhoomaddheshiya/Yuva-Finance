
'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { GroupSettings, Member, Transaction } from '@/types';
import { Banknote, Users, Percent, PiggyBank, ArrowDown, ArrowUp, Landmark, HandCoins, LibraryBig } from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { useUser, useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useDoc } from '@/firebase/firestore/use-doc';
import { collection, query, doc, Timestamp } from 'firebase/firestore';

function StatCard({
  title,
  value,
  icon: Icon,
  loading,
  description,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  loading: boolean;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-3/4" />
        ) : (
          <div className="text-2xl font-bold font-headline">{value}</div>
        )}
        {description && !loading && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { user } = useUser();
  const firestore = useFirestore();

  const membersRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/members`)) : null, [user, firestore]);
  const transactionsRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/transactions`)) : null, [user, firestore]);

  const { data: members, isLoading: membersLoading } = useCollection<Member>(membersRef);
  const { data: transactions, isLoading: txLoading } = useCollection<Transaction>(transactionsRef);
  
  const loading = membersLoading || txLoading;

  const { totalDeposits, totalLoan, totalRepayment, totalInterest, remainingFund } = useMemo(() => {
    if (!transactions) {
      return { totalDeposits: 0, totalLoan: 0, totalRepayment: 0, totalInterest: 0, remainingFund: 0 };
    }
    const memberDeposits = transactions
      .filter(t => t.type === 'deposit')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalLoan = transactions
      .filter(t => t.type === 'loan')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalRepayment = transactions
      .filter(t => t.type === 'repayment')
      .reduce((sum, t) => sum + (t.principal || 0), 0);
    
    const totalInterest = transactions
      .filter(t => t.type === 'repayment')
      .reduce((sum, t) => sum + (t.interest || 0), 0);

    // Total Deposits card should show all money contributed by members + interest earned
    const totalDeposits = memberDeposits + totalInterest;

    // Remaining fund is total cash in (deposits + interest + repayments) minus total cash out (loans)
    const remainingFund = (memberDeposits + totalInterest + totalRepayment) - totalLoan;
    
    return { totalDeposits, totalLoan, totalRepayment, totalInterest, remainingFund };
  }, [transactions]);


  const chartData = [
    { name: 'Deposits', total: totalDeposits, fill: 'hsl(var(--primary))' },
    { name: 'Loans', total: totalLoan, fill: 'hsl(var(--destructive))' },
  ];
  
  const getTransactionDate = (tx: Transaction): Date => {
    if (tx.date instanceof Timestamp) {
      return tx.date.toDate();
    }
    if (tx.date instanceof Date) {
      return tx.date;
    }
    // Fallback for string dates
    return new Date(tx.date as string);
  };

  const getTxIcon = (type: Transaction['type']) => {
    switch (type) {
      case 'deposit':
        return <div className="p-2 bg-green-100 rounded-full mr-4"><ArrowUp className="h-4 w-4 text-green-600"/></div>;
      case 'loan':
        return <div className="p-2 bg-red-100 rounded-full mr-4"><ArrowDown className="h-4 w-4 text-red-600"/></div>;
      case 'repayment':
        return <div className="p-2 bg-blue-100 rounded-full mr-4"><HandCoins className="h-4 w-4 text-blue-600"/></div>;
      default:
        return null;
    }
  }

  const getTxAmountClass = (type: Transaction['type']) => {
    switch (type) {
        case 'deposit': return 'text-green-600';
        case 'loan': return 'text-red-600';
        case 'repayment': return 'text-blue-600';
        default: return '';
    }
  }
  
  const getTxAmountPrefix = (type: Transaction['type']) => {
    switch (type) {
        case 'deposit': return '+';
        case 'repayment': return '+';
        case 'loan': return '-';
        default: return '';
    }
  }


  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold font-headline">Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Remaining Fund"
          value={loading ? '...' : `₹${remainingFund.toLocaleString('en-IN')}`}
          icon={Banknote}
          loading={loading}
          description="Cash available in group"
        />
         <StatCard
          title="Total Deposits"
          value={loading ? '...' : `₹${totalDeposits.toLocaleString('en-IN')}`}
          icon={PiggyBank}
          loading={loading}
          description="From all members"
        />
        <StatCard
          title="Total Loan Disbursed"
          value={loading ? '...' : `₹${totalLoan.toLocaleString('en-IN')}`}
          icon={Landmark}
          loading={loading}
          description="Outstanding + Repaid Principal"
        />
         <StatCard
          title="Total Interest Earned"
          value={loading ? '...' : `₹${totalInterest.toLocaleString('en-IN')}`}
          icon={LibraryBig}
          loading={loading}
          description="From loan repayments"
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle className="font-headline">Overview</CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={chartData}>
                <XAxis
                  dataKey="name"
                  stroke="#888888"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#888888"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `₹${Number(value) / 1000}k`}
                />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--muted))' }}
                  contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}
                  formatter={(value: number) => [`₹${value.toLocaleString('en-IN')}`, 'Total']}
                />
                <Bar dataKey="total" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="col-span-4 lg:col-span-3">
          <CardHeader>
            <CardTitle className="font-headline">Recent Transactions</CardTitle>
            <p className="text-sm text-muted-foreground">The last 5 transactions in the group.</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : (
              <div className="space-y-4">
                {transactions && members && transactions.length > 0 ? (
                  transactions
                    .sort((a, b) => {
                      const dateA = getTransactionDate(a);
                      const dateB = getTransactionDate(b);
                      return dateB.getTime() - dateA.getTime();
                    })
                    .slice(0, 5)
                    .map((tx) => (
                      <div key={tx.id} className="flex items-center">
                         {getTxIcon(tx.type)}
                        <div className="flex-1 space-y-1">
                          <p className="text-sm font-medium leading-none">{members.find(m => m.id === tx.memberId)?.name || 'Unknown Member'}</p>
                          <p className="text-sm text-muted-foreground">{tx.description || tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}</p>
                        </div>
                        <div className={`font-medium ${getTxAmountClass(tx.type)}`}>
                          {getTxAmountPrefix(tx.type)}₹{tx.amount.toLocaleString('en-IN')}
                        </div>
                      </div>
                    ))
                ) : (
                  <p>No transactions found.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
