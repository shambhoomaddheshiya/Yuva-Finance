
'use client';

import { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { GroupSettings, Member, Transaction } from '@/types';
import { ArrowDown, ArrowUp, Banknote, Users, Percent, Calendar, PiggyBank } from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { useUser, useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useDoc } from '@/firebase/firestore/use-doc';
import { collection, query, doc, setDoc } from 'firebase/firestore';

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

  const settingsRef = useMemoFirebase(() => user && firestore ? doc(firestore, `users/${user.uid}/groupSettings`, 'settings') : null, [user, firestore]);
  const membersRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/members`)) : null, [user, firestore]);
  const transactionsRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/transactions`)) : null, [user, firestore]);

  const { data: settings, isLoading: settingsLoading } = useDoc<GroupSettings>(settingsRef);
  const { data: members, isLoading: membersLoading } = useCollection<Member>(membersRef);
  const { data: transactions, isLoading: txLoading } = useCollection<Transaction>(transactionsRef);
  
  const loading = settingsLoading || membersLoading || txLoading;

  const totalDepositedThisPeriod = transactions ? transactions.filter(t => t.type === 'deposit').reduce((acc, t) => acc + t.amount, 0) : 0;
  const totalWithdrawnThisPeriod = transactions ? transactions.filter(t => t.type === 'withdrawal').reduce((acc, t) => acc + t.amount, 0) : 0;
  
  const totalDepositedAllTime = members ? members.reduce((sum, member) => sum + member.totalDeposited, 0) : 0;

  const chartData = [
    { name: 'Deposits', total: totalDepositedThisPeriod, fill: 'hsl(var(--primary))' },
    { name: 'Withdrawals', total: totalWithdrawnThisPeriod, fill: 'hsl(var(--destructive))' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold font-headline">Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Remaining Fund"
          value={settings ? `₹${settings.totalFund.toLocaleString('en-IN')}` : '...'}
          icon={Banknote}
          loading={loading}
          description="Current cash balance"
        />
         <StatCard
          title="Total Deposited So Far"
          value={members ? `₹${totalDepositedAllTime.toLocaleString('en-IN')}` : '...'}
          icon={PiggyBank}
          loading={loading}
          description="All-time deposits"
        />
        <StatCard
          title="Total Members"
          value={members ? members.length : '...'}
          icon={Users}
          loading={loading}
          description="Number of active members"
        />
        <StatCard
          title="Interest Rate"
          value={settings ? `${settings.interestRate}%` : '...'}
          icon={Percent}
          loading={loading}
          description="Annual interest rate"
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
                    .sort((a, b) => new Date(b.date as string).getTime() - new Date(a.date as string).getTime())
                    .slice(0, 5)
                    .map((tx) => (
                      <div key={tx.id} className="flex items-center">
                         {tx.type === 'deposit' ? (
                            <ArrowUp className="h-6 w-6 text-green-500 mr-4"/>
                          ) : (
                            <ArrowDown className="h-6 w-6 text-red-500 mr-4"/>
                          )}
                        <div className="flex-1 space-y-1">
                          <p className="text-sm font-medium leading-none">{members.find(m => m.id === tx.memberId)?.name || 'Unknown Member'}</p>
                          <p className="text-sm text-muted-foreground">{tx.description}</p>
                        </div>
                        <div className={`font-medium ${tx.type === 'deposit' ? 'text-green-600' : 'text-red-600'}`}>
                          Rs.{tx.amount.toLocaleString('en-IN')}
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
