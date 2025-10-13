'use client';

import { useState, useMemo } from 'react';
import { collection, query, Timestamp } from 'firebase/firestore';
import { useUser, useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { Member, Transaction } from '@/types';
import { format, getYear } from 'date-fns';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Banknote, Users, HandCoins, PiggyBank, Landmark } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

type MemberAmount = {
  name: string;
  amount: number;
}

function SummaryDetailCard({ 
  title, 
  icon: Icon, 
  totalAmount, 
  members, 
  loading,
  membersLabel
}: { 
  title: string; 
  icon: React.ElementType; 
  totalAmount: number; 
  members: MemberAmount[];
  loading: boolean;
  membersLabel: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-lg font-headline">{title}</CardTitle>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
          </div>
        ) : (
          <div className="flex justify-between items-start">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {membersLabel}: <span className="font-semibold">{members.length}</span>
              </p>
              {members.length > 0 && (
                <Accordion type="single" collapsible className="w-full max-w-xs">
                  <AccordionItem value="item-1">
                    <AccordionTrigger className="text-sm py-2">View Members</AccordionTrigger>
                    <AccordionContent>
                      <ul className="list-none text-sm text-muted-foreground space-y-1">
                        {members.map((member, index) => (
                          <li key={index} className="flex justify-between">
                            <span>{member.name}</span>
                            <span className="font-medium text-foreground">Rs {member.amount.toLocaleString('en-IN')}</span>
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
            </div>
            <div className="text-2xl font-bold font-headline text-right">
              Rs {totalAmount.toLocaleString('en-IN')}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SummaryPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  
  const [selectedYear, setSelectedYear] = useState<string>(String(getYear(new Date())));
  const [selectedMonth, setSelectedMonth] = useState<string>(String(new Date().getMonth()));

  const transactionsRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/transactions`)) : null, [user, firestore]);
  const membersRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/members`)) : null, [user, firestore]);

  const { data: transactions, isLoading: txLoading } = useCollection<Transaction>(transactionsRef);
  const { data: members, isLoading: membersLoading } = useCollection<Member>(membersRef);
  const loading = txLoading || membersLoading;

  const getTransactionDate = (tx: Transaction): Date => {
    if (tx.date instanceof Timestamp) {
      return tx.date.toDate();
    }
    return new Date(tx.date as string);
  };
  
  const monthlySummary = useMemo(() => {
    const initialSummary = {
        totalInterest: 0,
        interestPayers: [] as MemberAmount[],
        totalDeposit: 0,
        depositMembers: [] as MemberAmount[],
        totalLoan: 0,
        loanTakers: [] as MemberAmount[],
        totalRepayment: 0,
        repaymentMembers: [] as MemberAmount[],
    };

    if (!transactions || !members) {
      return initialSummary;
    }
    
    const year = parseInt(selectedYear);
    const month = parseInt(selectedMonth);

    const activeMemberIds = new Set(members.filter(m => m.status === 'active').map(m => m.id));
    const filteredTransactions = transactions.filter(tx => {
      const txDate = getTransactionDate(tx);
      return txDate.getFullYear() === year && txDate.getMonth() === month && activeMemberIds.has(tx.memberId);
    });
    
    const memberMap = new Map(members.map(m => [m.id, m.name]));

    const memberAggregates = new Map<string, { deposit: number; loan: number; principal: number, interest: number }>();

    for (const tx of filteredTransactions) {
      const memberId = tx.memberId;
      if (!memberAggregates.has(memberId)) {
        memberAggregates.set(memberId, { deposit: 0, loan: 0, principal: 0, interest: 0 });
      }
      const memberData = memberAggregates.get(memberId)!;

      switch (tx.type) {
        case 'deposit':
          memberData.deposit += tx.amount;
          break;
        case 'loan':
          memberData.loan += tx.amount;
          break;
        case 'repayment':
          memberData.principal += (tx.principal || 0);
          memberData.interest += (tx.interest || 0);
          break;
      }
    }
    
    let totalInterest = 0;
    const interestPayers: MemberAmount[] = [];
    let totalDeposit = 0;
    const depositMembers: MemberAmount[] = [];
    let totalLoan = 0;
    const loanTakers: MemberAmount[] = [];
    let totalRepayment = 0;
    const repaymentMembers: MemberAmount[] = [];

    for (const [memberId, data] of memberAggregates.entries()) {
        const name = memberMap.get(memberId) || 'Unknown';
        
        if (data.interest > 0) {
            totalInterest += data.interest;
            interestPayers.push({ name, amount: data.interest });
        }
        if (data.deposit > 0) {
            totalDeposit += data.deposit;
            depositMembers.push({ name, amount: data.deposit });
        }
        if (data.loan > 0) {
            totalLoan += data.loan;
            loanTakers.push({ name, amount: data.loan });
        }
        if (data.principal > 0) {
            totalRepayment += data.principal;
            repaymentMembers.push({ name, amount: data.principal });
        }
    }

    return { 
      totalInterest, 
      interestPayers,
      totalDeposit, 
      depositMembers,
      totalLoan,
      loanTakers, 
      totalRepayment,
      repaymentMembers
    };

  }, [transactions, members, selectedYear, selectedMonth]);

  const years = Array.from({ length: 10 }, (_, i) => getYear(new Date()) - i);
  const months = Array.from({ length: 12 }, (_, i) => ({
      value: String(i),
      label: format(new Date(0, i), 'MMMM'),
  }));


  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <h1 className="text-3xl font-bold font-headline">Monthly Summary</h1>
        <div className="flex items-center gap-2">
            <Select onValueChange={setSelectedYear} value={selectedYear}>
                <SelectTrigger className="w-[120px]"><SelectValue placeholder="Year" /></SelectTrigger>
                <SelectContent>
                    {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
            </Select>
            <Select onValueChange={setSelectedMonth} value={selectedMonth}>
               <SelectTrigger className="w-[140px]"><SelectValue placeholder="Month" /></SelectTrigger>
                <SelectContent>
                    {months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
            </Select>
        </div>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="font-headline">
             Summary for {format(new Date(parseInt(selectedYear), parseInt(selectedMonth)), 'MMMM yyyy')}
          </CardTitle>
          <CardDescription>An overview of your group's financial activity for the selected month.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
           <SummaryDetailCard
              title="Interest Earned"
              icon={Banknote}
              totalAmount={monthlySummary.totalInterest}
              members={monthlySummary.interestPayers}
              loading={loading}
              membersLabel="From Members"
           />
           <SummaryDetailCard
              title="Deposits Made"
              icon={PiggyBank}
              totalAmount={monthlySummary.totalDeposit}
              members={monthlySummary.depositMembers}
              loading={loading}
              membersLabel="By Members"
           />
           <SummaryDetailCard
              title="Loans Disbursed"
              icon={Landmark}
              totalAmount={monthlySummary.totalLoan}
              members={monthlySummary.loanTakers}
              loading={loading}
              membersLabel="To Members"
           />
           <SummaryDetailCard
              title="Loans Repaid (Principal)"
              icon={HandCoins}
              totalAmount={monthlySummary.totalRepayment}
              members={monthlySummary.repaymentMembers}
              loading={loading}
              membersLabel="By Members"
           />
        </CardContent>
      </Card>
    </div>
  );
}





