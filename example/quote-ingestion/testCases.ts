import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import type { TestCase } from '../../src/index';
import type { QuoteInput, QuoteOutput } from './types';

export const createTestCases = async () => {
    const testCases: TestCase<QuoteInput, QuoteOutput>[] = [];

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    );
    
    const { data, error } = await supabase.from('approval_workflow_metadata').select('id').or('testing_classification.eq.FAILURE,testing_classification.eq.REGRESSION');
    
    if (error) {
      console.error('Error fetching approval workflow metadata:', error);
      return [];
    }
    
    const ids = data.map((item) => item.id);
    
    for (const id of ids) {
      const { data, error } = await supabase.from('policy_period_quote').select('*').eq('email_id', id);
    
      if (error) {
        console.error('Error fetching policy period quotes:', error);
        return [];
      }
    
      const quotes = data.map((item) => item);
    
      testCases.push({
        input: { emailId: id },
        expected: quotes,
      });
    }

    return testCases;
}

