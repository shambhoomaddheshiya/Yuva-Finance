
'use client';

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { PlusCircle, Loader2, MoreHorizontal, Pencil, BookUser, Calendar as CalendarIcon, ArrowDown, ArrowUp, Trash2, Search } from 'lucide-react';
import { format } from 'date-fns';
import { collection, doc, query, where, writeBatch, getDocs, deleteDoc, getDoc, setDoc } from 'firebase/firestore';
import { useUser, useFirestore, setDocumentNonBlocking, useMemoFirebase, updateDocumentNonBlocking } from '@/firebase';

import { useCollection } from '@/firebase/firestore/use-collection';
import { useToast } from '@/hooks/use-toast';
import type { Member, Transaction, GroupSettings } from '@/types';

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
  aadhaar: z.string().refine(value => /^\d{4}-?\d{4}-?\d{4}$/.test(value) || /^\d{12}$/.test(value), {
    message: 'Aadhaar must be 12 digits.',
  }),
  joinDate: z.date({ required_error: 'A join date is required.' }),
});

function formatAadhaar(value: string) {
    const numericValue = value.replace(/-/g, '');
    let formattedValue = '';
    if (numericValue.length > 0) {
        formattedValue = numericValue.match(/.{1,4}/g)?.join('-') || '';
    }
    return formattedValue.substring(0, 14); // 12 digits + 2 hyphens
}

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
      aadhaar: member ? formatAadhaar(member.aadhaar) : '',
      joinDate: member ? new Date(member.joinDate) : new Date(),
    },
  });

  async function onSubmit(values: z.infer<typeof memberSchema>) {
    if (!user || !firestore) return;
    setIsLoading(true);
    try {
        const batch = writeBatch(firestore);
        const settingsDocRef = doc(firestore, `users/${user.uid}/groupSettings`, 'settings');
        const aadhaarUnformatted = values.aadhaar.replace(/-/g, '');
        
        if (isEdit && member) {
            // Logic for editing a member
            if (member.id !== values.id) {
                // ID has changed, complex update (migrate data)
                const newMemberDocRef = doc(firestore, `users/${user.uid}/members`, values.id);
                const newMemberData: Member = {
                    ...member,
                    id: values.id, name: values.name, phone: values.phone, aadhaar: aadhaarUnformatted, joinDate: values.joinDate.toISOString(),
                };
                batch.set(newMemberDocRef, newMemberData);

                const transactionsQuery = query(collection(firestore, `users/${user.uid}/transactions`), where('memberId', '==', member.id));
                const transactionsSnapshot = await getDocs(transactionsQuery);
                transactionsSnapshot.forEach(txDoc => {
                    batch.update(txDoc.ref, { memberId: values.id });
                });

                const oldMemberDocRef = doc(firestore, `users/${user.uid}/members`, member.id);
                batch.delete(oldMemberDocRef);
                
                toast({ title: 'Success!', description: 'Member ID changed and transactions updated.' });

            } else {
                // ID is the same, simple update
                const memberRef = doc(firestore, `users/${user.uid}/members`, member.id);
                const updatePayload: Partial<Member> = {
                    name: values.name, phone: values.phone, aadhaar: aadhaarUnformatted, joinDate: values.joinDate.toISOString()
                };
                batch.update(memberRef, updatePayload);
                toast({ title: 'Success!', description: 'Member has been updated.' });
            }
        } else {
            // Logic for adding a new member
            const newMember: Member = {
                id: values.id, name: values.name, phone: values.phone, aadhaar: aadhaarUnformatted,
                joinDate: values.joinDate.toISOString(),
                totalDeposited: 0, totalWithdrawn: 0, currentBalance: 0, interestEarned: 0,
            };
            const newMemberRef = doc(firestore, `users/${user.uid}/members`, values.id);
            batch.set(newMemberRef, newMember);

            // Also update totalMembers in groupSettings
            const settingsSnap = await getDoc(settingsDocRef);
            if (settingsSnap.exists()) {
                const settingsData = settingsSnap.data() as GroupSettings;
                batch.update(settingsDocRef, { totalMembers: (settingsData.totalMembers || 0) + 1 });
            } else {
                // If for some reason settings don't exist, create them
                 const defaultSettings: GroupSettings = {
                    groupName: 'My Savings Group', monthlyContribution: 1000, interestRate: 2,
                    totalMembers: 1, totalFund: 0, establishedDate: new Date().toISOString(),
                };
                batch.set(settingsDocRef, defaultSettings);
            }
            toast({ title: 'Success!', description: 'New member has been added.' });
        }
      
      await batch.commit();
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
                    <Input placeholder="MEMBER-001" {...field} disabled={isEdit} />
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
                <Input placeholder="Rahul Sharma" {...field} />
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
          name="aadhaar"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Aadhaar Number</FormLabel>
              <FormControl>
                <Input 
                    placeholder="1234-5678-9012" 
                    {...field}
                    onChange={(e) => {
                        const formatted = formatAadhaar(e.target.value);
                        field.onChange(formatted);
                    }}
                />
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
            <div className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
                <p><span className="font-semibold">Name:</span> {member.name}</p>
                <p><span className="font-semibold">ID:</span> {member.id}</p>
                <p><span className="font-semibold">Mob No:</span> {member.phone}</p>
                <p className="col-span-2"><span className="font-semibold">Aadhaar:</span> {formatAadhaar(member.aadhaar)}</p>
                <p><span className="font-semibold">Joined:</span> {new Date(member.joinDate).toLocaleDateString()}</p>
                <p className="col-span-3 font-medium"><span className="font-semibold">Balance:</span> Rs {member.currentBalance.toLocaleString('en-IN')}</p>
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
                                        <TableCell className={`text-right font-medium ${tx.type === 'deposit' ? 'text-green-600' : 'text-red-600'}`}>
                                            {tx.type === 'deposit' ? '+' : '-'}Rs {tx.amount.toLocaleString('en-IN')}
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
  const { toast } = useToast();
  const firestore = useFirestore();
  const membersRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/members`)) : null, [user, firestore]);
  const { data: memberList, isLoading: loading } = useCollection<Member>(membersRef);

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isPassbookOpen, setIsPassbookOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | undefined>(undefined);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredMembers = useMemo(() => {
    if (!memberList) return [];
    if (!searchQuery) return memberList;

    const lowercasedQuery = searchQuery.toLowerCase();
    return memberList.filter(member => 
        member.name.toLowerCase().includes(lowercasedQuery) ||
        member.id.toLowerCase().includes(lowercasedQuery) ||
        member.phone.includes(searchQuery) ||
        member.aadhaar.includes(searchQuery.replace(/-/g, ''))
    );
  }, [memberList, searchQuery]);


  const handleEdit = (member: Member) => {
    setSelectedMember(member);
    setIsEditDialogOpen(true);
  };

  const handlePassbook = (member: Member) => {
    setSelectedMember(member);
    setIsPassbookOpen(true);
  }

  const handleDelete = (member: Member) => {
    setSelectedMember(member);
    setIsDeleteDialogOpen(true);
  }

  const handleDeleteConfirm = async () => {
    if (!selectedMember || !user || !firestore) return;
    setIsDeleting(true);
    try {
        const memberId = selectedMember.id;
        const batch = writeBatch(firestore);

        // 1. Delete member document
        const memberDocRef = doc(firestore, `users/${user.uid}/members`, memberId);
        batch.delete(memberDocRef);

        // 2. Find and delete all transactions for that member
        const transactionsQuery = query(collection(firestore, `users/${user.uid}/transactions`), where('memberId', '==', memberId));
        const transactionsSnapshot = await getDocs(transactionsQuery);
        transactionsSnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });

        // 3. Update totalMembers and totalFund in groupSettings
        const settingsDocRef = doc(firestore, `users/${user.uid}/groupSettings`, 'settings');
        const settingsSnap = await getDoc(settingsDocRef);
        if (settingsSnap.exists()) {
            const settingsData = settingsSnap.data() as GroupSettings;
            const newTotalMembers = (settingsData.totalMembers || 0) > 0 ? settingsData.totalMembers - 1 : 0;
            const newTotalFund = (settingsData.totalFund || 0) - selectedMember.currentBalance;
            batch.update(settingsDocRef, { 
                totalMembers: newTotalMembers,
                totalFund: newTotalFund < 0 ? 0 : newTotalFund
            });
        }

        await batch.commit();

        toast({
            title: 'Success!',
            description: `Member ${selectedMember.name} and all their transactions have been deleted.`,
        });

    } catch (error: any) {
        toast({
            variant: 'destructive',
            title: 'Uh oh! Something went wrong.',
            description: error.message || 'There was a problem deleting the member.',
        });
    } finally {
        setIsDeleting(false);
        setIsDeleteDialogOpen(false);
        setSelectedMember(undefined);
    }
  };
  
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
           <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search members..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Member ID</TableHead>
                <TableHead>Mob No.</TableHead>
                <TableHead>Aadhaar</TableHead>
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
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-6 w-20 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredMembers && filteredMembers.length > 0 ? (
                filteredMembers.map((member, index) => (
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
                    <TableCell>{formatAadhaar(member.aadhaar)}</TableCell>
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
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleDelete(member)} className="text-destructive focus:bg-destructive/10 focus:text-destructive">
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
                  <TableCell colSpan={7} className="h-24 text-center">
                    {searchQuery ? 'No members match your search.' : 'No members found.'}
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

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete the member <span className="font-bold">{selectedMember?.name}</span> and all of their associated transactions.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive hover:bg-destructive/90" disabled={isDeleting}>
                    {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Yes, delete member
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
