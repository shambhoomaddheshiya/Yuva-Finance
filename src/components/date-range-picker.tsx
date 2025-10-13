
'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { DateRange } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface DateRangePickerProps extends React.HTMLAttributes<HTMLDivElement> {
  value: DateRange | undefined;
  onChange: (date: DateRange | undefined) => void;
}

const DateRangePicker = React.memo(
  ({ className, value, onChange }: DateRangePickerProps) => {
    const [month, setMonth] = React.useState<Date | undefined>(value?.from);

    React.useEffect(() => {
        if (value?.from) {
            setMonth(value.from);
        }
    }, [value?.from]);


    return (
      <div className={cn('grid gap-2', className)}>
        <Popover onOpenChange={() => setMonth(value?.from)}>
          <PopoverTrigger asChild>
            <Button
              id="date"
              variant={'outline'}
              className={cn(
                'w-[300px] justify-start text-left font-normal',
                !value && 'text-muted-foreground'
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {value?.from ? (
                value.to ? (
                  <>
                    {format(value.from, 'LLL dd, y')} -{' '}
                    {format(value.to, 'LLL dd, y')}
                  </>
                ) : (
                  format(value.from, 'LLL dd, y')
                )
              ) : (
                <span>Pick a date</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={value}
              onSelect={onChange}
              month={month}
              onMonthChange={setMonth}
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>
      </div>
    );
  }
);

DateRangePicker.displayName = 'DateRangePicker';

export { DateRangePicker };
