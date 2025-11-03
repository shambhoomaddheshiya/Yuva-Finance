
'use client';

import { useState, useMemo, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { PlusCircle, Loader2, Calendar as CalendarIcon, ArrowDown, ArrowUp, Search, MoreHorizontal, Pencil, Trash2, HandCoins, Banknote, PiggyBank, Landmark, ShieldX } from 'lucide-react';
import { collection, doc, getDoc, query, writeBatch, where, getDocs, deleteDoc, Timestamp, updateDoc, increment, setDoc, addDoc } from 'firebase/firestore';
import { format, getYear, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';

import { useCollection } from '@/firebase/firestore/use-collection';
import { useDoc } from '@/firebase/firestore/use-doc';
import { useToast } from '@/hooks/use-toast';
import type { Member, Transaction, GroupSettings } from '@/types';
import { useUser, useFirestore, useMemoFirebase } from '@/firebase';


import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { DateRange } from 'react-day-picker';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { Separator } from '@/components/ui/separator';


const transactionObjectSchema = z.object({
  memberId: z.string().nonempty('Please select a member.'),
  type: z.enum(['deposit', 'loan', 'repayment', 'expense', 'loan-waived'], {
    required_error: 'You need to select a transaction type.',
  }),
  amount: z.coerce.number().positive('Amount must be a positive number.'),
  date: z.date({ required_error: 'A date is required.' }),
  description: z.string().optional(),
  principal: z.coerce.number().optional(),
  interest: z.coerce.number().optional(),
  interestRate: z.coerce.number().optional(),
  loanId: z.string().optional(), // For repayments
});

const transactionSchema = transactionObjectSchema.superRefine((data, ctx) => {
    if (data.type === 'repayment') {
        if (!data.loanId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Please select which loan to repay.',
                path: ['loanId'],
            });
        }
        const principal = data.principal || 0;
        const interest = data.interest || 0;
        if (principal + interest !== data.amount) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Principal + Interest must equal the Total Amount.",
                path: ["amount"],
            });
        }
    }
});


// For the edit form - editing is complex so we'll simplify it
const editTransactionObjectSchema = transactionObjectSchema.omit({ memberId: true });

const editTransactionSchema = editTransactionObjectSchema.refine(data => {
    // This refine is specifically for repayment edits.
    // The form logic will determine if this schema should be used.
    if (data.type === 'repayment') {
        const principal = data.principal || 0;
        const interest = data.interest || 0;
        return principal + interest === data.amount;
    }
    return true;
}, {
    message: "For repayments, Principal + Interest must equal the Total Amount.",
    path: ["amount"],
});


function AddTransactionForm({ onOpenChange, globalLoanSequence }: { onOpenChange: (open: boolean) => void, globalLoanSequence: Map<string, number> }) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [activeLoans, setActiveLoans] = useState<Transaction[]>([]);
  const { user } = useUser();
  const firestore = useFirestore();

  const membersRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/members`), where('status', '==', 'active')) : null, [user, firestore]);
  const { data: members, isLoading: membersLoading } = useCollection<Member>(membersRef);

  const sortedMembers = useMemo(() => {
    if (!members) return [];
    return [...members].sort((a, b) => a.name.localeCompare(b.name));
  }, [members]);

  const allTransactionsRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/transactions`)) : null, [user, firestore]);
  const { data: allTransactions } = useCollection<Transaction>(allTransactionsRef);

  const form = useForm<z.infer<typeof transactionSchema>>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      memberId: '',
      amount: 0,
      principal: 0,
      interest: 0,
      interestRate: 0,
      description: '',
      date: new Date(),
      type: 'deposit',
      loanId: '',
    },
  });

  const transactionType = useWatch({ control: form.control, name: 'type' });
  const principal = useWatch({ control: form.control, name: 'principal' });
  const interest = useWatch({ control: form.control, name: 'interest' });

  useEffect(() => {
    if (transactionType === 'repayment') {
        const totalAmount = Number(principal || 0) + Number(interest || 0);
        form.setValue('amount', totalAmount, { shouldValidate: true });
    }
  }, [principal, interest, transactionType, form]);

  useEffect(() => {
    if (selectedMemberId && allTransactions) {
      const loans = allTransactions.filter(
        tx => tx.type === 'loan' && tx.memberId === selectedMemberId && tx.status === 'active'
      );
      setActiveLoans(loans);
    } else {
      setActiveLoans([]);
    }
    form.setValue('loanId', ''); // Reset loan selection when member changes
  }, [selectedMemberId, allTransactions, form]);

  const handleMemberChange = (memberId: string) => {
    setSelectedMemberId(memberId);
    form.setValue('memberId', memberId);
  }

  const memberBalances = useMemo(() => {
    if (!selectedMemberId || !allTransactions) return { depositBalance: 0, loanBalance: 0 };
    
    let depositBalance = 0;
    let loanBalance = 0;

    for (const tx of allTransactions) {
      if (tx.memberId === selectedMemberId) {
        if (tx.type === 'deposit') {
          depositBalance += tx.amount;
        } else if (tx.type === 'loan') {
          loanBalance += tx.amount;
        } else if (tx.type === 'repayment') {
          loanBalance -= (tx.principal || 0);
        } else if (tx.type === 'loan-waived') {
            loanBalance -= tx.amount;
        }
      }
    }
    return { depositBalance, loanBalance };
  }, [selectedMemberId, allTransactions]);

  const membersWithActiveLoans = useMemo(() => {
    if (!allTransactions || !members) return [];
    const activeLoanMemberIds = new Set(allTransactions.filter(tx => tx.type === 'loan' && tx.status === 'active').map(tx => tx.memberId));
    return members.filter(m => activeLoanMemberIds.has(m.id));
  }, [allTransactions, members]);

  const membersForDropdown = useMemo(() => {
    if (transactionType === 'repayment') {
        return membersWithActiveLoans;
    }
    return sortedMembers;
  }, [transactionType, sortedMembers, membersWithActiveLoans]);


  async function onSubmit(values: z.infer<typeof transactionSchema>) {
    if (!user || !firestore) return;
    setIsLoading(true);

    try {
        const newTxRef = doc(collection(firestore, `users/${user.uid}/transactions`));
        
        let newTxData: Omit<Transaction, 'id'> = {
            memberId: values.memberId,
            type: values.type,
            amount: values.amount,
            date: Timestamp.fromDate(values.date),
            description: values.description,
        };

        if (values.type === 'loan') {
            newTxData.loanId = newTxRef.id; // Use the document's own ID as the loan ID
            newTxData.status = 'active';
            newTxData.interestRate = values.interestRate || 0;
        }

        if (values.type === 'repayment') {
            newTxData.principal = values.principal || 0;
            newTxData.interest = values.interest || 0;
            newTxData.loanId = values.loanId;
        }

        await setDoc(newTxRef, newTxData);

        if (values.type === 'repayment' && values.loanId) {
            // After a successful repayment, check if the corresponding loan is now fully paid.
            const loanQuery = query(collection(firestore, `users/${user.uid}/transactions`), where('loanId', '==', values.loanId), where('type', '==', 'loan'));
            const loanSnapshot = await getDocs(loanQuery);
            
            if (!loanSnapshot.empty) {
                const loanDoc = loanSnapshot.docs[0];
                const loanData = loanDoc.data() as Transaction;
                const loanAmount = loanData.amount;
                
                const repaymentsQuery = query(
                    collection(firestore, `users/${user.uid}/transactions`),
                    where('type', '==', 'repayment'),
                    where('loanId', '==', values.loanId)
                );
                const repaymentsSnapshot = await getDocs(repaymentsQuery);
                let totalPrincipalPaid = repaymentsSnapshot.docs.reduce((sum, doc) => sum + (doc.data().principal || 0), 0);
                
                if (totalPrincipalPaid >= loanAmount) {
                    await updateDoc(loanDoc.ref, { status: 'closed' });
                }
            }
        }
        
        toast({
            title: 'Success!',
            description: 'New transaction has been recorded.',
        });
        form.reset();
        onOpenChange(false);
    
    } catch (error) {
        console.error("Transaction submission failed:", error);
        toast({
            variant: 'destructive',
            title: 'Uh oh! Something went wrong.',
            description: 'There was a problem recording your transaction.',
        });
    } finally {
        setIsLoading(false);
    }
  }


  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="memberId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Member</FormLabel>
              <Select onValueChange={handleMemberChange} defaultValue={field.value} disabled={membersLoading}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a member" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {membersForDropdown?.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem className="space-y-3">
              <FormLabel>Transaction Type</FormLabel>
              <FormControl>
                <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex gap-x-4 flex-wrap">
                  <FormItem className="flex items-center space-x-2 space-y-0">
                    <FormControl><RadioGroupItem value="deposit" /></FormControl>
                    <FormLabel className="font-normal">Deposit</FormLabel>
                  </FormItem>
                  <FormItem className="flex items-center space-x-2 space-y-0">
                    <FormControl><RadioGroupItem value="loan" /></FormControl>
                    <FormLabel className="font-normal">Loan</FormLabel>
                  </FormItem>
                  <FormItem className="flex items-center space-x-2 space-y-0">
                    <FormControl><RadioGroupItem value="repayment" /></FormControl>
                    <FormLabel className="font-normal">Repayment</FormLabel>
                  </FormItem>
                  <FormItem className="flex items-center space-x-2 space-y-0">
                    <FormControl><RadioGroupItem value="expense" /></FormControl>
                    <FormLabel className="font-normal">Expense</FormLabel>
                  </FormItem>
                   <FormItem className="flex items-center space-x-2 space-y-0">
                    <FormControl><RadioGroupItem value="loan-waived" /></FormControl>
                    <FormLabel className="font-normal">Loan (Waived)</FormLabel>
                  </FormItem>
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {transactionType === 'repayment' ? (
            <>
                <FormField
                    control={form.control}
                    name="loanId"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Select Loan to Repay</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                            <SelectTrigger>
                                <SelectValue placeholder="Select an active loan" />
                            </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                            {activeLoans.length > 0 ? (
                                activeLoans.map((loan) => (
                                <SelectItem key={loan.id} value={loan.loanId!}>
                                    {`Loan #${globalLoanSequence.get(loan.loanId!)?.toString().padStart(3, '0')} of Rs. ${loan.amount} on ${format(loan.date.toDate(), 'PP')}`}
                                </SelectItem>
                                ))
                            ) : (
                                <SelectItem value="no-loans" disabled>
                                No active loans for this member.
                                </SelectItem>
                            )}
                            </SelectContent>
                        </Select>
                        <FormMessage />
                        </FormItem>
                    )}
                />
                <div className="grid grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="principal"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Principal Amount</FormLabel>
                                <FormControl><Input type="number" placeholder="10000" {...field} value={field.value || ''} /></FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="interest"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Interest Paid</FormLabel>
                                <FormControl><Input type="number" placeholder="200" {...field} value={field.value || ''}/></FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="amount"
                        render={({ field }) => (
                            <FormItem className="col-span-2">
                            <FormLabel>Total Amount Repaid</FormLabel>
                            <FormControl><Input type="number" {...field} readOnly className="bg-muted" /></FormControl>
                            <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>
            </>
        ) : transactionType === 'loan' ? (
             <div className="grid grid-cols-2 gap-4">
                 <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Loan Amount</FormLabel>
                        <FormControl><Input type="number" placeholder="50000" {...field} /></FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="interestRate"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Interest Rate (%)</FormLabel>
                            <FormControl><Input type="number" placeholder="2" {...field} value={field.value || ''}/></FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </div>
        ) : (
            <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl><Input type="number" placeholder="2000" {...field} /></FormControl>
                    <FormMessage />
                    </FormItem>
                )}
            />
        )}
        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Date</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant={'outline'}
                      className={cn(
                        'w-[240px] pl-3 text-left font-normal',
                        !field.value && 'text-muted-foreground'
                      )}
                    >
                      {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    captionLayout="dropdown-buttons"
                    fromYear={getYear(new Date()) - 10}
                    toYear={getYear(new Date())}
                    selected={field.value}
                    onSelect={field.onChange}
                    disabled={(date) => date > new Date() || date < new Date('1900-01-01')}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl><Textarea placeholder="मासिक जमा - ..." {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter className="!mt-8 p-0 sm:justify-center">
            <div className="flex flex-col w-full max-w-sm mx-auto">
                <Button type="submit" disabled={isLoading} className="h-12 text-lg rounded-b-none bg-primary hover:bg-primary/90 text-primary-foreground">
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Record Transaction'}
                </Button>
                {selectedMemberId && (
                    <div className="text-sm w-full space-y-2 border border-t-0 rounded-b-md p-4">
                        <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Total Deposit</span>
                            <span className="font-medium font-mono">
                                Rs. {memberBalances.depositBalance.toLocaleString('en-IN')}
                            </span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Active Loan</span>
                            <span className="font-medium font-mono">
                                Rs. {memberBalances.loanBalance.toLocaleString('en-IN')}
                            </span>
                        </div>
                         <Separator />
                        <div className="flex justify-between items-center font-semibold">
                            <span>Remaining Fund</span>
                            <span className="font-mono">
                                Rs. {(memberBalances.depositBalance - memberBalances.loanBalance).toLocaleString('en-IN')}
                            </span>
                        </div>
                    </div>
                )}
            </div>
        </DialogFooter>
      </form>
    </Form>
  );
}

function EditTransactionForm({ onOpenChange, transaction }: { onOpenChange: (open: boolean) => void, transaction: Transaction }) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useUser();
  const firestore = useFirestore();

  const getDateFromTransaction = (tx: Transaction) => {
    if (tx.date instanceof Timestamp) {
      return tx.date.toDate();
    }
    return new Date(tx.date as string);
  }

  const isRepayment = transaction.type === 'repayment';
  const isLoan = transaction.type === 'loan';

  const form = useForm<z.infer<typeof editTransactionObjectSchema>>({
    resolver: zodResolver(isRepayment ? editTransactionSchema : editTransactionObjectSchema),
    defaultValues: {
      date: getDateFromTransaction(transaction),
      description: transaction.description || '',
      amount: transaction.amount,
      principal: transaction.principal || 0,
      interest: transaction.interest || 0,
      interestRate: transaction.interestRate || 0,
      type: transaction.type,
    },
  });
  
  const principal = useWatch({ control: form.control, name: 'principal' });
  const interest = useWatch({ control: form.control, name: 'interest' });

  useEffect(() => {
    if (isRepayment) {
        const totalAmount = Number(principal || 0) + Number(interest || 0);
        form.setValue('amount', totalAmount, { shouldValidate: true });
    }
  }, [principal, interest, isRepayment, form]);

  async function onSubmit(values: z.infer<typeof editTransactionObjectSchema>) {
    if (!user || !firestore) return;
    setIsLoading(true);

    try {
        const txRef = doc(firestore, `users/${user.uid}/transactions`, transaction.id);
        
        const updatedTxData: Partial<Transaction> = {
            date: Timestamp.fromDate(values.date),
            description: values.description,
            amount: values.amount,
        };

        if (transaction.type === 'repayment') {
            updatedTxData.principal = values.principal || 0;
            updatedTxData.interest = values.interest || 0;
        }

        if (transaction.type === 'loan') {
            updatedTxData.interestRate = values.interestRate || 0;
        }


        await updateDoc(txRef, updatedTxData);

        toast({
            title: 'Success!',
            description: 'Transaction has been updated.',
        });
        onOpenChange(false);

    } catch (error: any) {
        toast({
            variant: 'destructive',
            title: 'Update Failed',
            description: error.message || 'There was a problem updating the transaction.',
        });
    } finally {
        setIsLoading(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
         {isRepayment ? (
            <div className="grid grid-cols-2 gap-4">
                <FormField
                    control={form.control}
                    name="principal"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Principal Amount</FormLabel>
                            <FormControl><Input type="number" placeholder="10000" {...field} /></FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="interest"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Interest Paid</FormLabel>
                            <FormControl><Input type="number" placeholder="200" {...field} /></FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                 <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                        <FormItem className="col-span-2">
                        <FormLabel>Total Amount Repaid</FormLabel>
                        <FormControl><Input type="number" {...field} readOnly className="bg-muted" /></FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                />
            </div>
        ) : isLoan ? (
             <div className="grid grid-cols-2 gap-4">
                 <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Loan Amount</FormLabel>
                        <FormControl><Input type="number" placeholder="50000" {...field} /></FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="interestRate"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Interest Rate (%)</FormLabel>
                            <FormControl><Input type="number" placeholder="2" {...field} /></FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </div>
        ) : (
            <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl><Input type="number" placeholder="2000" {...field} /></FormControl>
                    <FormMessage />
                    </FormItem>
                )}
            />
        )}
        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Date</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant={'outline'}
                      className={cn(
                        'w-[240px] pl-3 text-left font-normal',
                        !field.value && 'text-muted-foreground'
                      )}
                    >
                      {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    captionLayout="dropdown-buttons"
                    fromYear={getYear(new Date()) - 10}
                    toYear={getYear(new Date())}
                    selected={field.value}
                    onSelect={field.onChange}
                    disabled={(date) => date > new Date() || date < new Date('1900-01-01')}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl><Textarea placeholder="Description..." {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}

function DateFilterControls({ dateFilter, selectedYear, setSelectedYear, selectedMonth, setSelectedMonth }) {
    const years = Array.from({ length: 10 }, (_, i) => getYear(new Date()) - i);
    const months = Array.from({ length: 12 }, (_, i) => ({
        value: String(i),
        label: format(new Date(0, i), 'MMMM'),
    }));
    const [startDate, setStartDate] = useState<Date | undefined>();
    const [endDate, setEndDate] = useState<Date | undefined>();


    if (dateFilter !== 'monthly' && dateFilter !== 'yearly' && dateFilter !== 'custom') return null;

    if (dateFilter === 'custom') {
        return (
            <div className="flex items-center gap-2">
                 <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant={"outline"}
                            className={cn(
                                "w-[150px] justify-start text-left font-normal",
                                !startDate && "text-muted-foreground"
                            )}
                        >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {startDate ? format(startDate, "PPP") : <span>Start Date</span>}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                        <Calendar
                            mode="single"
                            selected={startDate}
                            onSelect={setStartDate}
                            initialFocus
                        />
                    </PopoverContent>
                </Popover>
                 <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant={"outline"}
                            className={cn(
                                "w-[150px] justify-start text-left font-normal",
                                !endDate && "text-muted-foreground"
                            )}
                        >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {endDate ? format(endDate, "PPP") : <span>End Date</span>}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                        <Calendar
                            mode="single"
                            selected={endDate}
                            onSelect={setEndDate}
                            initialFocus
                        />
                    </PopoverContent>
                </Popover>
            </div>
        )
    }

    return (
        <div className="flex items-center gap-2">
            <Select onValueChange={setSelectedYear} value={selectedYear}>
                <SelectTrigger className="w-[120px]"><SelectValue placeholder="Year" /></SelectTrigger>
                <SelectContent>
                    {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
            </Select>
            {dateFilter === 'monthly' && (
                <Select onValueChange={setSelectedMonth} value={selectedMonth}>
                   <SelectTrigger className="w-[140px]"><SelectValue placeholder="Month" /></SelectTrigger>
                    <SelectContent>
                        {months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                </Select>
            )}
        </div>
    );
}

function StatCard({
  title,
  value,
  icon: Icon,
  loading,
}: {
  title: string;
  value: string | number;
  icon?: React.ElementType;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-3/4" />
        ) : (
          <div className="text-2xl font-bold font-headline">{value}</div>
        )}
      </CardContent>
    </Card>
  );
}


export default function TransactionsPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const firestore = useFirestore();
  
  const transactionsRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/transactions`)) : null, [user, firestore]);
  const membersRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/members`)) : null, [user, firestore]);
  
  const { data: transactions, isLoading: txLoading } = useCollection<Transaction>(transactionsRef);
  const { data: members, isLoading: membersLoading } = useCollection<Member>(membersRef);
  
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | undefined>(undefined);
  const [isDeleting, setIsDeleting] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [selectedYear, setSelectedYear] = useState<string>(String(getYear(new Date())));
  const [selectedMonth, setSelectedMonth] = useState<string>(String(new Date().getMonth()));
  const [customDateRange, setCustomDateRange] = useState<DateRange | undefined>();

  const loading = txLoading || membersLoading;
  
  const getTransactionDate = (tx: Transaction) => {
    if (tx.date instanceof Timestamp) {
        return tx.date.toDate();
    }
    return new Date(tx.date as string);
  };
  
  const getTxTypeClass = (type: Transaction['type']) => {
    switch (type) {
        case 'deposit': return 'border-transparent bg-green-100 text-green-800';
        case 'loan': return 'border-transparent bg-red-100 text-red-800';
        case 'repayment': return 'border-transparent bg-blue-100 text-blue-800';
        case 'expense': return 'border-transparent bg-orange-100 text-orange-800';
        case 'loan-waived': return 'border-transparent bg-yellow-100 text-yellow-800';
        default: return '';
    }
  }

  const getTxAmountClass = (type: Transaction['type']) => {
    switch (type) {
        case 'deposit': return 'text-green-600';
        case 'loan': return 'text-red-600';
        case 'repayment': return 'text-blue-600';
        case 'expense': return 'text-orange-600';
        case 'loan-waived': return 'text-yellow-600';
        default: return '';
    }
  }

  const getTxTypeIcon = (type: Transaction['type']) => {
    switch(type) {
      case 'deposit': return <ArrowUp className="mr-1 h-3 w-3" />;
      case 'loan': return <ArrowDown className="mr-1 h-3 w-3" />;
      case 'repayment': return <HandCoins className="mr-1 h-3 w-3" />;
      case 'expense': return <ShieldX className="mr-1 h-3 w-3" />;
      case 'loan-waived': return <ShieldX className="mr-1 h-3 w-3" />;
    }
  }
  
  const getTxAmountPrefix = (type: Transaction['type']) => {
    switch (type) {
        case 'deposit': return '+';
        case 'repayment': return '+';
        case 'loan': return '-';
        case 'expense': return '-';
        case 'loan-waived': return '-';
        default: return '';
    }
  }

  const globalLoanSequence = useMemo(() => {
    const sequence = new Map<string, number>();
    if (!transactions) return sequence;

    const allLoans = transactions
      .filter(tx => tx.type === 'loan' && tx.loanId)
      .sort((a, b) => getTransactionDate(a).getTime() - getTransactionDate(b).getTime());

    allLoans.forEach((loan, index) => {
      sequence.set(loan.loanId!, index + 1);
    });

    return sequence;
  }, [transactions]);


  const filteredTransactions = useMemo(() => {
    if (!transactions || !members) return [];
    
    let intermediateList = [...transactions].sort((a, b) => getTransactionDate(b).getTime() - getTransactionDate(a).getTime());

    // Type Filtering
    if (typeFilter !== 'all') {
        intermediateList = intermediateList.filter(tx => tx.type === typeFilter);
    }
    
    // Date Filtering
    intermediateList = intermediateList.filter(tx => {
        const txDate = getTransactionDate(tx);
        const txYear = getYear(txDate);
        const txMonth = txDate.getMonth();

        switch (dateFilter) {
            case 'monthly':
                if (txYear !== parseInt(selectedYear) || txMonth !== parseInt(selectedMonth)) return false;
                break;
            case 'yearly':
                if(txYear !== parseInt(selectedYear)) return false;
                break;
            case 'custom':
                if (customDateRange?.from && customDateRange?.to) {
                    const fromDate = startOfMonth(customDateRange.from);
                    const toDate = endOfMonth(customDateRange.to);
                    if (txDate < fromDate || txDate > toDate) return false;
                } else if(customDateRange?.from) {
                     if (txDate < customDateRange.from) return false;
                }
                break;
            case 'all':
            default:
                break;
        }
        return true;
    });

    if (!searchQuery) return intermediateList;

    const lowercasedQuery = searchQuery.toLowerCase();
    
    return intermediateList.filter(tx => {
      const member = members.find(m => m.id === tx.memberId);
      const memberName = member ? member.name.toLowerCase() : '';
      
      return (
        memberName.includes(lowercasedQuery) ||
        (tx.description && tx.description.toLowerCase().includes(lowercasedQuery))
      );
    });
  }, [transactions, members, searchQuery, typeFilter, dateFilter, selectedYear, selectedMonth, customDateRange]);
  
  const summaryTotals = useMemo(() => {
    const initialValues = { totalDeposits: 0, totalRemainingFund: 0, filteredDeposits: 0, filteredLoans: 0, filteredRepayments: 0, filteredExpenses: 0 };
    if (!transactions || !members) {
      return initialValues;
    }
    
    const contributingMemberIds = new Set(members.filter(m => m.status === 'active' || m.status === 'closed').map(m => m.id));
    const contributingTransactions = transactions.filter(t => contributingMemberIds.has(t.memberId));

    const memberDeposits = contributingTransactions
      .filter(t => t.type === 'deposit')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalInterest = contributingTransactions
      .filter(t => t.type === 'repayment')
      .reduce((sum, t) => sum + (t.interest || 0), 0);
    
    const totalLoan = contributingTransactions
      .filter(t => t.type === 'loan')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalRepaymentPrincipal = contributingTransactions
      .filter(t => t.type === 'repayment')
      .reduce((sum, t) => sum + (t.principal || 0), 0);

    const totalExpenses = contributingTransactions
      .filter(t => t.type === 'expense' || t.type === 'loan-waived')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalDepositsValue = (memberDeposits + totalInterest) - totalExpenses;
    const remainingFund = (memberDeposits + totalInterest + totalRepaymentPrincipal) - totalLoan;
    
    const filteredTotals = {
        deposits: 0,
        loans: 0,
        repayments: 0,
        expenses: 0,
    }
    for (const tx of filteredTransactions) {
        if (tx.type === 'deposit') filteredTotals.deposits += tx.amount;
        if (tx.type === 'loan') filteredTotals.loans += tx.amount;
        if (tx.type === 'repayment') filteredTotals.repayments += tx.amount;
        if (tx.type === 'expense' || tx.type === 'loan-waived') filteredTotals.expenses += tx.amount;
    }

    return { 
        totalDeposits: totalDepositsValue, 
        totalRemainingFund: remainingFund,
        filteredDeposits: filteredTotals.deposits,
        filteredLoans: filteredTotals.loans,
        filteredRepayments: filteredTotals.repayments,
        filteredExpenses: filteredTotals.expenses,
    };
  }, [transactions, members, filteredTransactions]);


  const handleEdit = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setIsEditDialogOpen(true);
  };

  const handleDelete = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedTransaction || !user || !firestore) return;
    setIsDeleting(true);

    const txToDelete = selectedTransaction;

    try {
        const txRef = doc(firestore, `users/${user.uid}/transactions`, txToDelete.id);
        await deleteDoc(txRef);
        
        // If the deleted transaction was a repayment, re-evaluate the loan status
        if (txToDelete.type === 'repayment' && txToDelete.loanId) {
            const loanQuery = query(collection(firestore, `users/${user.uid}/transactions`), where('loanId', '==', txToDelete.loanId), where('type', '==', 'loan'));
            const loanSnapshot = await getDocs(loanQuery);

            if (!loanSnapshot.empty) {
                const loanDoc = loanSnapshot.docs[0];
                const loanData = loanDoc.data() as Transaction;
                
                // If loan was closed, check if it should be re-opened
                if (loanData.status === 'closed') {
                     const repaymentsQuery = query(
                        collection(firestore, `users/${user.uid}/transactions`),
                        where('type', '==', 'repayment'),
                        where('loanId', '==', txToDelete.loanId)
                    );
                    const repaymentsSnapshot = await getDocs(repaymentsQuery);
                    const totalPrincipalPaid = repaymentsSnapshot.docs.reduce((sum, doc) => sum + (doc.data().principal || 0), 0);

                    if (totalPrincipalPaid < loanData.amount) {
                        await updateDoc(loanDoc.ref, { status: 'active' });
                        toast({
                            title: 'Loan Status Updated',
                            description: `Loan #${txToDelete.loanId} has been automatically reopened as it is no longer fully paid.`
                        });
                    }
                }
            }
        }
        
        toast({
            title: 'Success!',
            description: `Transaction has been deleted.`,
        });

    } catch (error: any) {
         toast({
            variant: 'destructive',
            title: 'Delete Failed',
            description: error.message || 'There was a problem deleting the transaction.',
        });
    } finally {
        setIsDeleting(false);
        setIsDeleteDialogOpen(false);
        setSelectedTransaction(undefined);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold font-headline">Transactions</h1>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Transaction
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="font-headline">Record New Transaction</DialogTitle>
              <DialogDescription>
                Select a member and enter the transaction details.
              </DialogDescription>
            </DialogHeader>
            <AddTransactionForm onOpenChange={setIsAddDialogOpen} globalLoanSequence={globalLoanSequence} />
          </DialogContent>
        </Dialog>
      </div>
      
       <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
         <StatCard
            title="Filtered Deposits"
            value={loading ? '...' : `Rs. ${summaryTotals.filteredDeposits.toLocaleString('en-IN')}`}
            loading={loading}
          />
          <StatCard
            title="Filtered Repayments"
            value={loading ? '...' : `Rs. ${summaryTotals.filteredRepayments.toLocaleString('en-IN')}`}
            loading={loading}
          />
           <StatCard
            title="Filtered Loans"
            value={loading ? '...' : `Rs. ${summaryTotals.filteredLoans.toLocaleString('en-IN')}`}
            loading={loading}
          />
          <StatCard
            title="Filtered Expenses"
            value={loading ? '...' : `Rs. ${summaryTotals.filteredExpenses.toLocaleString('en-IN')}`}
            loading={loading}
          />
          <StatCard
            title="Total Remaining Fund"
            value={loading ? '...' : `Rs. ${summaryTotals.totalRemainingFund.toLocaleString('en-IN')}`}
            icon={Banknote}
            loading={loading}
          />
          <StatCard
            title="Total Deposits"
            value={loading ? '...' : `Rs. ${summaryTotals.totalDeposits.toLocaleString('en-IN')}`}
            icon={PiggyBank}
            loading={loading}
          />
       </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-headline">Transaction History</CardTitle>
           <div className="space-y-4 pt-2">
             <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by member, description..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex items-center gap-4">
                  <Label className="font-semibold shrink-0">Filter by Type:</Label>
                  <RadioGroup
                    value={typeFilter}
                    onValueChange={setTypeFilter}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2"
                  >
                    <div className="flex items-center space-x-2"><RadioGroupItem value="all" id="all-type" /><Label htmlFor="all-type">All</Label></div>
                    <div className="flex items-center space-x-2"><RadioGroupItem value="deposit" id="deposit" /><Label htmlFor="deposit">Deposits</Label></div>
                    <div className="flex items-center space-x-2"><RadioGroupItem value="loan" id="loan" /><Label htmlFor="loan">Loans</Label></div>
                    <div className="flex items-center space-x-2"><RadioGroupItem value="repayment" id="repayment" /><Label htmlFor="repayment">Repayments</Label></div>
                     <div className="flex items-center space-x-2"><RadioGroupItem value="expense" id="expense" /><Label htmlFor="expense">Expenses</Label></div>
                     <div className="flex items-center space-x-2"><RadioGroupItem value="loan-waived" id="loan-waived" /><Label htmlFor="loan-waived">Loan Waived</Label></div>
                  </RadioGroup>
                </div>
                <div className="flex items-center gap-4">
                  <Label className="font-semibold shrink-0">Filter by Date:</Label>
                  <RadioGroup
                    value={dateFilter}
                    onValueChange={setDateFilter}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2"
                  >
                    <div className="flex items-center space-x-2"><RadioGroupItem value="all" id="all-date" /><Label htmlFor="all-date">All Time</Label></div>
                    <div className="flex items-center space-x-2"><RadioGroupItem value="monthly" id="monthly" /><Label htmlFor="monthly">Monthly</Label></div>
                    <div className="flex items-center space-x-2"><RadioGroupItem value="yearly" id="yearly" /><Label htmlFor="yearly">Yearly</Label></div>
                  </RadioGroup>
                </div>
                 <DateFilterControls 
                 dateFilter={dateFilter}
                 selectedYear={selectedYear}
                 setSelectedYear={setSelectedYear}
                 selectedMonth={selectedMonth}
                 setSelectedMonth={setSelectedMonth}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(6)].map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-6 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredTransactions.length > 0 ? (
                filteredTransactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="font-medium">{members?.find(m => m.id === tx.memberId)?.name || 'Unknown'}</TableCell>
                    <TableCell>
                      <div className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${getTxTypeClass(tx.type)}`}>
                        {getTxTypeIcon(tx.type)}
                        {tx.type}
                      </div>
                    </TableCell>
                    <TableCell>{getTransactionDate(tx).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {tx.type === 'loan' && tx.loanId ? (
                        <div className="flex flex-col">
                            <span className="text-xs text-muted-foreground">
                              Loan #{globalLoanSequence.get(tx.loanId)?.toString().padStart(3, '0')}
                            </span>
                            <span>Rate: {tx.interestRate}% | Status: <span className={cn('font-semibold', tx.status === 'active' ? 'text-green-600' : 'text-gray-500')}>{tx.status}</span></span>
                        </div>
                      ) : (
                        tx.description
                      )}
                    </TableCell>
                    <TableCell className={`text-right font-mono font-semibold ${getTxAmountClass(tx.type)}`}>
                      {getTxAmountPrefix(tx.type)}Rs. {tx.amount.toLocaleString('en-IN')}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit(tx)} >
                            <Pencil className="mr-2 h-4 w-4" />
                            <span>Edit</span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleDelete(tx)} className="text-destructive focus:bg-destructive/10 focus:text-destructive">
                            <Trash2 className="mr-2 h-4 w-4" />
                            <span>Delete</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                     {searchQuery || typeFilter !== 'all' || dateFilter !== 'all' ? 'No transactions match your filters.' : 'No transactions found.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline">Edit Transaction</DialogTitle>
            <DialogDescription>
              Update the transaction details below.
            </DialogDescription>
          </DialogHeader>
          {selectedTransaction && <EditTransactionForm onOpenChange={setIsEditDialogOpen} transaction={selectedTransaction} />}
        </DialogContent>
      </Dialog>
      
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete the transaction. Balances will be recalculated automatically.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive hover:bg-destructive/90" disabled={isDeleting}>
                    {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Yes, delete transaction
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

