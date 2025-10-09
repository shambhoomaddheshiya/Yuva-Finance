'use client';

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { PlusCircle, Loader2, MoreHorizontal, Pencil, BookUser, Calendar as CalendarIcon, ArrowDown, ArrowUp } from 'lucide-react';
import { format } from 'date-fns';
import { collection, doc, query, where, writeBatch, getDocs } from 'firebase/firestore';
import { useUser, useFirestore, setDocumentNonBlocking, useMemoFirebase, updateDocumentNonBlocking } from '@/firebase';

import { useCollection } from '@/firebase/firestore/use-collection';
import { useToast } from '@/hooks/use-toast';
import type { Member, Transaction } from '@/types';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { cn } from '@/lib/utils';
import { addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';

const memberSchema = z.object({
  id: z.string().min(1, 'Member ID cannot be empty.'),
  name: z.string().min(2, 'Name must be at least 2 characters.'),
  phone: z.string().regex(/^\d{10}$/, 'Phone number must be 10 digits.'),
  joinDate: z.date({ required_error: 'A join date is required.' }),
});

function MemberForm({ onOpenChange, member, isEdit = false }: { onOpenChange: (open: boolean) => void, member?: Member, isEdit?: boolean }) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useUser();
  const firestore = useFirestore();

  const form = useForm<z.infer<typeof memberSchema>>({
    resolver: zodResolver(memberSchema),
    defaultValues: { 
      id: member?.id || '',
      name: member?.name || '', 
      phone: member?.phone || '',
      joinDate: member ? new Date(member.joinDate) : new Date(),
    },
  });

  async function onSubmit(values: z.infer<typeof memberSchema>) {
    if (!user || !firestore) return;
    setIsLoading(true);
    try {
        const membersRef = collection(firestore, `users/${user.uid}/members`);
      if (isEdit && member) {
        if (member.id !== values.id) {
          // ID has changed, so we need to create a new doc and delete the old one
          const batch = writeBatch(firestore);

          // 1. Create new member document
          const newMemberDocRef = doc(firestore, `users/${user.uid}/members`, values.id);
          const newMemberData: Member = {
            ...member, // carry over balance etc.
            id: values.id,
            name: values.name,
            phone: values.phone,
            joinDate: values.joinDate.toISOString(),
          };
          batch.set(newMemberDocRef, newMemberData);

          // 2. Find and update transactions with the old memberId
          const transactionsQuery = query(collection(firestore, `users/${user.uid}/transactions`), where('memberId', '==', member.id));
          const transactionsSnapshot = await getDocs(transactionsQuery);
          transactionsSnapshot.forEach(txDoc => {
            batch.update(txDoc.ref, { memberId: values.id });
          });

          // 3. Delete the old member document
          const oldMemberDocRef = doc(firestore, `users/${user.uid}/members`, member.id);
          batch.delete(oldMemberDocRef);

          await batch.commit();

          toast({
            title: 'Success!',
            description: 'Member ID has been changed and transactions updated.',
          });

        } else {
            // Update existing member, ID has not changed
            const memberRef = doc(membersRef, member.id);
            const updatePayload: Partial<Member> = {
              name: values.name,
              phone: values.phone,
              joinDate: values.joinDate.toISOString()
            }
            updateDocumentNonBlocking(memberRef, updatePayload);
            toast({
              title: 'Success!',
              description: 'Member has been updated.',
            });
        }
      } else {
        // Add new member
        const newMember: Member = {
          ...values,
          joinDate: values.joinDate.toISOString(),
          totalDeposited: 0,
          totalWithdrawn: 0,
          currentBalance: 0,
          interestEarned: 0,
        };
        const newMemberRef = doc(membersRef, values.id);
        setDocumentNonBlocking(newMemberRef, newMember, {});
        
        toast({
          title: 'Success!',
          description: 'New member has been added.',
        });
      }
      
      form.reset();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Uh oh! Something went wrong.',
        description: error.message || 'There was a problem with your request.',
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
            name="id"
            render={({ field }) => (
                <FormItem>
                <FormLabel>Member ID</FormLabel>
                <FormControl>
                    <Input placeholder="MEMBER-001" {...field} />
                </FormControl>
                <FormMessage />
                </FormItem>
            )}
        />
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full Name</FormLabel>
              <FormControl>
                <Input placeholder="राहुल शर्मा" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone Number</FormLabel>
              <FormControl>
                <Input placeholder="9876543210" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
         <FormField
          control={form.control}
          name="joinDate"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Join Date</FormLabel>
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
                    selected={field.value}
                    onSelect={field.onChange}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? 'Save Changes' : 'Add Member'}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}


function PassbookView({ member }: { member: Member }) {
    const { user } = useUser();
    const firestore = useFirestore();
    const transactionsRef = useMemoFirebase(
      () => user && firestore ? query(collection(firestore, `users/${user.uid}/transactions`), where('memberId', '==', member.id)) : null,
      [user, firestore, member.id]
    );
    const { data: transactions, isLoading } = useCollection<Transaction>(transactionsRef);
  
    const sortedTransactions = useMemo(() => {
        return transactions ? [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) : [];
    }, [transactions]);

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
                <p><span className="font-semibold">Name:</span> {member.name}</p>
                <p><span className="font-semibold">ID:</span> {member.id}</p>
                <p><span className="font-semibold">Joined:</span> {new Date(member.joinDate).toLocaleDateString()}</p>
                <p><span className="font-semibold">Balance:</span> ₹{member.currentBalance.toLocaleString('en-IN')}</p>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle className='font-headline text-lg'>Transaction History</CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                         <div className="space-y-2">
                            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                         </div>
                    ) : sortedTransactions.length > 0 ? (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead className="text-right">Amount</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedTransactions.map(tx => (
                                    <TableRow key={tx.id}>
                                        <TableCell>{new Date(tx.date).toLocaleDateString()}</TableCell>
                                        <TableCell className='capitalize'>
                                            <div className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${tx.type === 'deposit' ? 'border-transparent bg-green-100 text-green-800' : 'border-transparent bg-red-100 text-red-800'}`}>
                                                {tx.type === 'deposit' ? <ArrowUp className="mr-1 h-3 w-3" /> : <ArrowDown className="mr-1 h-3 w-3" />}
                                                {tx.type}
                                            </div>
                                        </TableCell>
                                        <TableCell className={`text-right font-mono ${tx.type === 'deposit' ? 'text-green-600' : 'text-red-600'}`}>
                                            {tx.type === 'deposit' ? '+' : '-'}₹{tx.amount.toLocaleString('en-IN')}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    ) : (
                        <p className="text-center text-muted-foreground">No transactions found for this member.</p>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}


export default function MembersPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const membersRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/members`)) : null, [user, firestore]);
  const { data: memberList, isLoading: loading } = useCollection<Member>(membersRef);

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isPassbookOpen, setIsPassbookOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | undefined>(undefined);

  const handleEdit = (member: Member) => {
    setSelectedMember(member);
    setIsEditDialogOpen(true);
  };

  const handlePassbook = (member: Member) => {
    setSelectedMember(member);
    setIsPassbookOpen(true);
  }
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold font-headline">Members</h1>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Member
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle className="font-headline">Add New Member</DialogTitle>
              <DialogDescription>
                Enter the details of the new member to add them to the group.
              </DialogDescription>
            </DialogHeader>
            <MemberForm onOpenChange={setIsAddDialogOpen} />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-headline">Member Roster</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Member ID</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-6 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-6 w-20 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : memberList && memberList.length > 0 ? (
                memberList.map((member, index) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                         <Avatar>
                          <AvatarImage src={PlaceHolderImages[index % PlaceHolderImages.length]?.imageUrl} data-ai-hint="person portrait" />
                          <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        {member.name}
                      </div>
                    </TableCell>
                    <TableCell>{member.id}</TableCell>
                    <TableCell>{member.phone}</TableCell>
                    <TableCell>{new Date(member.joinDate).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right font-mono">₹{member.currentBalance.toLocaleString('en-IN')}</TableCell>
                     <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit(member)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            <span>Edit</span>
                          </DropdownMenuItem>
                           <DropdownMenuItem onClick={() => handlePassbook(member)}>
                            <BookUser className="mr-2 h-4 w-4" />
                            <span>Passbook</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    No members found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="font-headline">Edit Member</DialogTitle>
            <DialogDescription>
              Update the member's details below.
            </DialogDescription>
          </DialogHeader>
          {selectedMember && <MemberForm onOpenChange={setIsEditDialogOpen} member={selectedMember} isEdit={true} />}
        </DialogContent>
      </Dialog>

      <Dialog open={isPassbookOpen} onOpenChange={setIsPassbookOpen}>
        <DialogContent className="sm:max-w-lg">
            <DialogHeader>
                <DialogTitle className='font-headline'>Member Passbook</DialogTitle>
                 <DialogDescription>
                    Transaction history for {selectedMember?.name}.
                </DialogDescription>
            </DialogHeader>
            {selectedMember && <PassbookView member={selectedMember} />}
        </DialogContent>
      </Dialog>

    </div>
  );
}
